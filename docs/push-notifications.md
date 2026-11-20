# Push notifications

Members get a push notification when something new appears on their home screen to-do list or a
session plan is first shared with them, and admins get one for each new join request. Members turn to-do notifications off in **Your details**.

## How it works

- The app registers each phone's Expo push token with the club's database when an approved member
  signs in (`register_push_device`), along with the club code, so a tapped notification opens the
  club it came from.
- Every 5 minutes a `pg_cron` job in each club's database (`send-todo-pushes`) works out each
  member's to-do list with `member_todos`, which calls the same functions as the home screen, and
  sends anything new through Expo's free push service with `pg_net`. No server or paid service is
  involved.
- Nothing is sent between 8 pm and 7 am in the club's time zone (`club_settings.timezone`,
  `Australia/Perth` by default; `push_quiet_hours` is the one place that works it out). Several
  new to-dos go in one notification.
- A session plan shared with someone for the first time sends its own notification
  (`notify_session_plan_shared`), whatever their to-do switch says. It keeps the same quiet hours:
  a plan shared between 8 pm and 7 am is held (`session_plan_notices.push_held`), and a second job
  (`send-held-session-plan-pushes`, every 5 minutes) sends it at 7 am to everyone the plan is
  still shared with, several plans in one notification.
- Each to-do is sent once (`push_todo_log`). The first time a member's list is checked, or when they
  turn notifications back on, what's already on it is noted and not sent.
- `member_todos` mirrors `buildTodos` in `src/lib/todos.ts`. A new or changed to-do needs both, the
  database side in a new migration.

## What has to be set up once

Push notifications only reach installed builds (TestFlight, the Android APK or the stores), never
Expo Go or the web. Expo's push service needs the club app's Apple and Google credentials:

**iPhone (APNs).** Needs the paid Apple Developer account. The next iOS build asks whether to set up
push notifications: answer yes to "Setup Push Notifications for your project" and "Generating a new
Apple Push Notifications service key". EAS keeps the key. To do it without building, run
`npx eas-cli@latest credentials`, choose iOS, then the push notifications key.

**Android (Firebase Cloud Messaging).**

1. In the [Firebase console](https://console.firebase.google.com), create a project (free) and add
   an Android app with the package name `au.pivt.firstpass.hq`.
2. Download its `google-services.json`, put it in the repository root and add
   `"googleServicesFile": "./google-services.json"` under `android` in `app.json`. It holds public
   identifiers only, so it can be committed.
3. In Firebase, open **Project settings > Service accounts**, click **Generate new private key** and
   keep the JSON file safe. Never commit it.
4. Upload that key to EAS: `npx eas-cli@latest credentials`, then **Android > production > Google
   Service Account > Manage your Google Service Account Key for Push Notifications (FCM V1) > Upload a
   new service account key**, or on expo.dev under **Credentials > Android > FCM V1 service account
   key**.
5. Make a new Android build. Adding `google-services.json` changes the native app, so an
   over-the-air update isn't enough.

Until these are done, the rest still works: the switch saves, phones register when they can, and
the database works out what to send.

## Checking it

In the Supabase SQL editor, `select * from cron.job where jobname = 'send-todo-pushes';` shows the
job, and `select * from cron.job_run_details order by start_time desc limit 5;` its last runs.
`select * from net._http_response order by created desc limit 5;` shows Expo's replies, including
any error about missing credentials.
