"""Regression tests for sms_state.json round-trip persistence.

Filed as the acceptance criterion for Issue #8 — `cn_*` and any other
prefixed state-key group must survive a save_state/load_state cycle
unmodified. If a future change introduces a key whitelist, a pop, or any
schema-filtering on the writer path, these tests will catch it before it
ships.

Run locally with:
    python -m pytest test_state_persistence.py -v
or:
    python test_state_persistence.py
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock


# Import the live functions. We patch STATE_FILE per-test so we never touch
# the real production sms_state.json from a test process.
import sms_followup


class StateRoundTripTests(unittest.TestCase):
    def setUp(self):
        # Each test gets a fresh temp state file. We patch the module-level
        # STATE_FILE constant for the duration of the test so save_state /
        # load_state operate on the temp path.
        fd, self.tmp = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        os.unlink(self.tmp)  # save_state will recreate it
        self._patch = mock.patch.object(sms_followup, 'STATE_FILE', self.tmp)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        if os.path.exists(self.tmp):
            os.unlink(self.tmp)

    def test_cn_keys_survive_one_cycle(self):
        """Per Issue #8: cn_* keys must survive save_state -> load_state."""
        state = {
            'CONTACT_A': {
                'sms_count':   3,
                'cn_started':  '2026-05-13T10:00:00+00:00',
                'cn_attempts': 1,
                'cn_last_at':  '2026-05-13T10:00:00+00:00',
                'cn_done':     False,
            },
        }
        sms_followup.save_state(state)
        loaded = sms_followup.load_state()
        self.assertEqual(loaded, state, 'state dict mutated by save/load cycle')
        for k in ('cn_started', 'cn_attempts', 'cn_last_at', 'cn_done'):
            self.assertIn(k, loaded['CONTACT_A'],
                          f'{k} dropped from state during save/load')

    def test_cn_last_at_none_roundtrips(self):
        """cn_last_at is initialized to None on first tick — must survive."""
        state = {'CONTACT_B': {'cn_started': '2026-05-13T10:00:00+00:00',
                               'cn_attempts': 0,
                               'cn_last_at': None}}
        sms_followup.save_state(state)
        loaded = sms_followup.load_state()
        self.assertIsNone(loaded['CONTACT_B']['cn_last_at'])
        self.assertIn('cn_last_at', loaded['CONTACT_B'])

    def test_arbitrary_prefixed_keys_survive(self):
        """Future-proofing: any xy_* / qq_* / whatever_* group must survive too.

        If someone ever adds a key whitelist to save_state, this test fails.
        """
        state = {
            'CONTACT_C': {
                'xy_started':    '2026-05-13T10:00:00+00:00',
                'qq_count':      42,
                'foo_payload':   {'nested': ['a', 'b', None, 1.5]},
                'sms_count':     0,
            },
        }
        sms_followup.save_state(state)
        loaded = sms_followup.load_state()
        self.assertEqual(loaded, state)

    def test_multi_contact_no_cross_contamination(self):
        state = {
            'C1': {'cn_attempts': 1, 'cn_last_at': '2026-05-13T00:00:00+00:00'},
            'C2': {'sms_count': 5, 'stage_name': 'qualified'},
            'C3': {'cn_done': True, 'replied': True},
        }
        sms_followup.save_state(state)
        loaded = sms_followup.load_state()
        self.assertEqual(loaded, state)
        # And specifically: C1's cn_* keys are preserved, C2's aren't synthesized.
        self.assertEqual(set(loaded['C1'].keys()), {'cn_attempts', 'cn_last_at'})
        self.assertNotIn('cn_attempts', loaded['C2'])

    def test_empty_state_roundtrips(self):
        sms_followup.save_state({})
        self.assertEqual(sms_followup.load_state(), {})

    def test_missing_state_file_returns_empty(self):
        # save_state never called — load_state must handle the missing file.
        self.assertFalse(os.path.exists(self.tmp))
        self.assertEqual(sms_followup.load_state(), {})


class ReplyAnchorRegressionTests(unittest.TestCase):
    """Regression tests for the 2026-05-08 reply-anchor + tag-prebail hotfix
    (PR `fix/reply-anchor-and-tag-prebail`).

    Root cause we are testing against:
      Bryan / Adam / Steven replied on May 7. On May 8 a state cleanup
      stamped `stage_entered_at = "2026-05-08T..."`. The OLD anchor calc
      took `max(last_sms_at, stage_entered_at, ghl_latest_outbound)` —
      which, with last_sms_at cleared, evaluated to "May 8 now", AFTER
      the May 7 inbound reply. has_inbound_since returned False, and the
      cadence sent another SMS.

    These tests exercise the NEW behavior:
      (1) anchor calc no longer includes stage_entered_at, so the May 7
          reply is correctly detected as newer than last_sms_at /
          ghl_latest_outbound.
      (2) `already_routed_reply` is checked at the TOP of process_lead,
          before anchor calc, so contacts who already carry a replied-*
          tag are bailed out unconditionally — even when the anchor math
          would otherwise have missed the reply.
    """

    def setUp(self):
        fd, self.tmp = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        os.unlink(self.tmp)
        self._patch = mock.patch.object(sms_followup, 'STATE_FILE', self.tmp)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        if os.path.exists(self.tmp):
            os.unlink(self.tmp)

    # ---- helpers --------------------------------------------------------

    @staticmethod
    def _msg(direction, when_iso, body='', mtype='SMS'):
        return {'direction': direction, 'dateAdded': when_iso,
                'body': body, 'messageType': mtype}

    @staticmethod
    def _entry(cid='BRYAN', stage_name='qualified'):
        return {'cid': cid, 'oid': 'OPP1', 'stage': 'STAGE1',
                'stage_name': stage_name}

    @staticmethod
    def _contact(tags=None, phone='+15555550100', state='PA',
                 first='Bryan', last='Carestia', addr1='123 Main St'):
        return {
            'firstName': first, 'lastName': last,
            'phone': phone, 'state': state, 'address1': addr1,
            'tags': list(tags or []),
            'dnd': False, 'dndSettings': {},
        }

    # ---- anchor-fix regression -----------------------------------------

    def test_anchor_ignores_stage_entered_at_so_prior_inbound_is_detected(self):
        """Bryan's exact scenario.

        stage_entered_at is stamped AFTER the seller's actual reply.
        Old code used max(last_sms_at, stage_entered_at, ghl_outbound) and
        picked stage_entered_at (which was "now"), missing the May 7 reply.
        New code drops stage_entered_at from the anchor calc.
        """
        state = {
            'BRYAN': {
                'stage_name':       'qualified',
                # State was cleaned/reset — last_sms_at cleared, stage_entered_at
                # bumped to May 8 (AFTER the seller's actual May 7 reply).
                'stage_entered_at': '2026-05-08T00:00:00+00:00',
                'sms_count':        0,
                'last_sms_at':      '2026-05-07T20:00:00+00:00',
                'replied':          False,
                'dormant':          False,
            },
        }
        # GHL conversation: we sent an SMS on May 7 at 20:00 UTC, seller
        # replied on May 7 at 22:00 UTC — BEFORE stage_entered_at.
        messages = [
            self._msg('outbound', '2026-05-07T20:00:00.000Z',  mtype='SMS'),
            self._msg('inbound',  '2026-05-07T22:00:00.000Z',
                      body='yes interested'),
        ]
        contact = self._contact()
        entry   = self._entry(cid='BRYAN')

        # Stub out all the network/Anthropic/Slack/etc paths.
        with mock.patch.object(sms_followup, '_scan_messages',
                               return_value=messages), \
             mock.patch.object(sms_followup, 'classify_reply',
                               return_value='POSITIVE'), \
             mock.patch.object(sms_followup, 'add_tag'), \
             mock.patch.object(sms_followup, 'create_task',
                               return_value=True), \
             mock.patch.object(sms_followup, 'slack_post'), \
             mock.patch.object(sms_followup, 'send_sms') as send, \
             mock.patch.object(sms_followup, 'set_dnd'):
            result = sms_followup.process_lead(entry, contact, state)

        # The classifier path should have flagged this as a reply, and
        # send_sms must NOT have been called.
        self.assertTrue(state['BRYAN']['replied'],
                        'reply NOT detected — anchor calc is still wrong')
        self.assertTrue(result.startswith('replied-'),
                        f'expected replied-* result, got {result!r}')
        send.assert_not_called()

    def test_has_inbound_since_with_pre_stage_anchor_finds_reply(self):
        """Lower-level sanity: has_inbound_since on the outbound-only anchor
        should detect the May 7 reply, while has_inbound_since with a
        stage_entered_at anchor (the broken path) misses it."""
        messages = [
            self._msg('outbound', '2026-05-07T20:00:00.000Z',  mtype='SMS'),
            self._msg('inbound',  '2026-05-07T22:00:00.000Z',
                      body='yes interested'),
        ]
        # Correct anchor: last outbound at 20:00 UTC May 7.
        replied, when, body = sms_followup.has_inbound_since(
            'BRYAN', '2026-05-07T20:00:00+00:00', messages=messages)
        self.assertTrue(replied, 'has_inbound_since must detect May 7 reply '
                                 'when anchor is the May 7 outbound')
        self.assertIn('interested', body or '')

        # Broken (old) anchor: stage_entered_at on May 8 AFTER the reply.
        replied_broken, _, _ = sms_followup.has_inbound_since(
            'BRYAN', '2026-05-08T00:00:00+00:00', messages=messages)
        self.assertFalse(replied_broken,
                         'sanity: stage-entry-anchor must NOT see the May 7 '
                         'reply — that\'s the original bug we are fixing.')

    def test_anchor_falls_back_to_stage_entered_when_no_outbound(self):
        """A truly fresh contact with no outbound history should NOT be
        flagged as replied off ancient historical inbound — we fall back
        to stage_entered_at as the anchor in that one case."""
        state = {
            'FRESH': {
                'stage_name':       'qualified',
                'stage_entered_at': '2026-05-08T00:00:00+00:00',
                'sms_count':        0,
                'last_sms_at':      None,
                'replied':          False,
                'dormant':          False,
            },
        }
        # Inbound from years ago, no outbound ever.
        messages = [
            self._msg('inbound',  '2023-01-15T12:00:00.000Z',
                      body='hello'),
        ]
        contact = self._contact(first='Fresh', last='Lead')
        entry   = self._entry(cid='FRESH')

        with mock.patch.object(sms_followup, '_scan_messages',
                               return_value=messages), \
             mock.patch.object(sms_followup, 'classify_reply',
                               return_value='POSITIVE'), \
             mock.patch.object(sms_followup, 'add_tag'), \
             mock.patch.object(sms_followup, 'create_task',
                               return_value=True), \
             mock.patch.object(sms_followup, 'slack_post'), \
             mock.patch.object(sms_followup, 'send_sms',
                               return_value=(True, 'mid_fresh')), \
             mock.patch.object(sms_followup, 'set_dnd'), \
             mock.patch.object(sms_followup, 'last_outbound_within',
                               return_value=(False, None)):
            result = sms_followup.process_lead(entry, contact, state)

        # Should NOT be classified as a reply (inbound is BEFORE
        # stage_entered_at fallback anchor). Cadence proceeds normally.
        self.assertFalse(state['FRESH']['replied'])
        self.assertTrue(result.startswith('sent#') or result == 'wait',
                        f'expected sent#/wait, got {result!r}')

    # ---- tag-prebail regression ----------------------------------------

    def test_tag_prebail_short_circuits_before_anchor_calc(self):
        """Even if the anchor calc would miss the reply, a replied-*
        tag on the live GHL contact must short-circuit at the top of
        process_lead. No anchor work, no _scan_messages, no send."""
        state = {
            'TAGGED': {
                'stage_name':       'qualified',
                'stage_entered_at': '2026-05-08T00:00:00+00:00',
                'sms_count':        2,
                # last_sms_at is AFTER any imaginable May 7 inbound, so the
                # NEW anchor would also miss the reply. The tag is the only
                # thing standing between us and a double-send.
                'last_sms_at':      '2026-05-08T01:00:00+00:00',
                'replied':          False,
                'dormant':          False,
            },
        }
        contact = self._contact(tags=['replied-stage-qualified', 'lead'])
        entry   = self._entry(cid='TAGGED')

        with mock.patch.object(sms_followup, '_scan_messages') as scan, \
             mock.patch.object(sms_followup, 'send_sms') as send, \
             mock.patch.object(sms_followup, 'add_tag'), \
             mock.patch.object(sms_followup, 'create_task'), \
             mock.patch.object(sms_followup, 'slack_post'):
            result = sms_followup.process_lead(entry, contact, state)

        # The tag-prebail short-circuit must NOT have hit the network or
        # tried to send.
        scan.assert_not_called()
        send.assert_not_called()
        self.assertEqual(result, 'skipped-tag-prebail')
        self.assertTrue(state['TAGGED']['replied'])
        self.assertEqual(state['TAGGED'].get('skip_reason'),
                         'tag-already-routed')

    def test_tag_prebail_recognizes_each_replied_prefix(self):
        """Any tag matching the REPLIED_TAG_PREFIXES set must trip the
        prebail — not just replied-stage-*."""
        prefixes_to_check = [
            'replied-stage-mao',
            'replied-positive-qualified',
            'replied-negative-lao',
            'replied-wrong-rr',
            'replied-hard_stop-qualified',
            'replied-hostile-mao',
            'dnd-opt-out',
            'not-interested',
            'wrong-number',
        ]
        for tag in prefixes_to_check:
            with self.subTest(tag=tag):
                state = {
                    'C1': {
                        'stage_name':       'qualified',
                        'stage_entered_at': '2026-05-08T00:00:00+00:00',
                        'sms_count':        0,
                        'last_sms_at':      None,
                        'replied':          False,
                        'dormant':          False,
                    },
                }
                contact = self._contact(tags=[tag])
                entry   = self._entry(cid='C1')
                with mock.patch.object(sms_followup, '_scan_messages') as scan, \
                     mock.patch.object(sms_followup, 'send_sms') as send:
                    result = sms_followup.process_lead(entry, contact, state)
                self.assertEqual(result, 'skipped-tag-prebail',
                                 f'tag {tag!r} did not trip prebail')
                send.assert_not_called()
                scan.assert_not_called()


if __name__ == '__main__':
    unittest.main()
