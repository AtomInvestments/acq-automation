# Wiring `SLACK_WEBHOOK_URL` for failure alerts

Both `.github/workflows/sms.yml` and `.github/workflows/acq.yml` already
open a GitHub Issue tagged `auto-alert` whenever a scheduled run fails
— that path works out of the box using the built-in `GITHUB_TOKEN` and
requires no secret-wiring.

Adding a Slack incoming webhook is **strictly additive**: it pings a
Slack channel in parallel with the GitHub Issue, so you get a faster
in-channel notification on top of the email/mobile push that GitHub
already gives you. Skip this entirely if you're happy with the GitHub
Issue path.

## 5-step setup

1. **Create a Slack incoming-webhook URL** in your workspace.
   - Open <https://api.slack.com/apps> -> *Create New App* -> *From scratch*.
   - Name it (e.g. `acq-automation-alerts`) and pick the workspace.
   - Left sidebar -> *Incoming Webhooks* -> toggle **Activate Incoming Webhooks** -> *On*.
   - *Add New Webhook to Workspace* -> pick the channel you want
     alerts in (e.g. `#acq-alerts`) -> *Allow*.
   - Copy the generated URL — looks like
     `https:// hooks.slack.com /services/ T<TEAM_ID> / B<BOT_ID> / <TOKEN>`.

2. **Set the URL as a repo secret.** From a shell with `gh` authed as
   you (the repo admin):

   ```sh
   gh secret set SLACK_WEBHOOK_URL \
     --body "https:// hooks.slack.com /services/ T<TEAM_ID> / B<BOT_ID> / <TOKEN>" \
     --repo AtomInvestments/acq-automation
   ```

   Or set it manually at
   <https://github.com/AtomInvestments/acq-automation/settings/secrets/actions>
   -> *New repository secret* -> Name `SLACK_WEBHOOK_URL`, paste the
   URL as the value.

3. **Verify the secret is wired** — without leaking the URL itself:

   ```sh
   gh secret list --repo AtomInvestments/acq-automation | grep SLACK_WEBHOOK_URL
   ```

   Should show `SLACK_WEBHOOK_URL  Updated YYYY-MM-DD`.

4. **Test the wiring by forcing a workflow failure.** The least-invasive
   way is to manually dispatch one of the workflows after temporarily
   breaking a secret (e.g. invalidate `GHL_TOKEN` for one run) — or
   wait for the next real failure. The `Notify Slack on failure` step
   will fire any time the job exits non-zero AND `SLACK_WEBHOOK_URL` is
   set.

5. **(Optional) tighten the guard.** Right now the Slack step's `if:`
   condition is `failure() && env.SLACK_WEBHOOK_URL != ''`, so a missing
   secret degrades silently. Once the secret is permanently wired, you
   can drop the `env.SLACK_WEBHOOK_URL != ''` guard so a missing webhook
   becomes an actionable warning rather than a silent skip:

   ```yaml
   - name: Notify Slack on failure
     if: failure()        # <-- removed the env guard
     env:
       SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
   ```

## Rotation

To rotate the webhook URL (e.g. if it's leaked):

1. In the Slack App config, *Incoming Webhooks* -> *Delete* the old hook.
2. Add a new hook to the same channel.
3. Re-run step 2 above with the new URL.

## Removing Slack entirely

If you ever want to drop Slack alerts and rely only on GitHub Issues:

```sh
gh secret remove SLACK_WEBHOOK_URL --repo AtomInvestments/acq-automation
```

The Slack step's `env.SLACK_WEBHOOK_URL != ''` guard will then skip it
on every run, leaving only the GitHub-Issue path.
