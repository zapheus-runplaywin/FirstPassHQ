# Trying the app in GitHub Codespaces

A codespace is a computer in the cloud with the app's code on it, opened in your browser. You can
run the app from it without installing anything, and try it in Expo Go on your phone or in a
browser tab. Like `npx expo start` on your own computer, it uses the **test** Supabase project
([Test and live](environments.md)), so nothing you do reaches members.

## One-time setup

1. In GitHub, open **Settings > Codespaces** (your own settings, not the repository's), and under
   **Secrets** add two secrets with the test project's values from its **Project Settings > API**.
   Give each one access to this repository.
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   Codespace secrets never go in the code. Use the test project's values, not the live ones.
2. In the test project's **Authentication > URL Configuration**, check `exp://**` is under
   **Redirect URLs** (it already is if Expo Go works on your computer). To sign in from the
   browser preview too, also add `https://*.app.github.dev/**`.

## Start it

1. On the repository's page, choose **Code > Codespaces > Create codespace on main** (or on the
   branch you want to try). The first start takes a few minutes while it installs everything.
2. In the codespace's terminal, run:

   ```bash
   npm run start:tunnel
   ```

3. **On your phone:** scan the QR code with Expo Go (Android) or the Camera app (iPhone). The
   tunnel gives the dev server a public `exp.direct` address, so your phone doesn't need to be on
   the same network.
4. **In a browser:** press `w` in the terminal. Codespaces shows a notice for port 8081; choose
   **Open in Browser**. The preview is private to your GitHub account.

Press `Ctrl+C` to stop. Stop the codespace too when you're done (**Code > Codespaces**, then
**Stop codespace**), or it stops by itself after 30 minutes idle.

## Limits

- **The tunnel can drop.** It runs through Expo's free ngrok service. If Expo Go can't connect or
  the terminal says the tunnel closed, press `Ctrl+C` and run `npm run start:tunnel` again.
  Reloads are slower than on your own network.
- **Free hours.** Personal GitHub accounts get 120 core hours a month free (60 hours on the
  standard 2-core machine) and 15 GB of storage. Stopped codespaces still use storage; delete old
  ones from **Code > Codespaces**.
- **Expo Go only.** A codespace can't make installable builds or run iOS or Android emulators. Use
  [Beta builds from GitHub](beta-builds.md) for those. Push notifications don't work in Expo Go.
