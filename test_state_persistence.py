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


if __name__ == '__main__':
    unittest.main()
