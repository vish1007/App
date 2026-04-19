# Admin Security Upgrade

Use [secure_apps_script.gs](/abs/path/c:/Users/singh/OneDrive/Pictures/Q-APP/App/secure_apps_script.gs) as the new Google Apps Script backend for admin login and question upload.

## What Changes

- Admin login now checks a hashed password instead of plain text.
- The admin page receives a short-lived session token after login.
- Bulk uploads use that session token instead of resending the password each time.
- Admin login and question upload can work even when the exam is not currently open.

## Sheet Changes

Update the `Admin` sheet to use these columns:

1. Column `A`: `username`
2. Column `B`: `password_hash`
3. Column `C`: `active`

Example:

| username | password_hash | active |
| --- | --- | --- |
| admin | generated hash | YES |

## How To Set A Password

After pasting `secure_apps_script.gs` into Google Apps Script:

1. Run `setAdminPassword("admin", "YourNewStrongPassword123!")`
2. Approve permissions if Google asks
3. Check the `Admin` sheet

Column `B` will be replaced with the SHA-256 hash, not the real password.

## Important Notes

- Your current plain password `quiz123` should be replaced.
- After updating Apps Script, redeploy the web app so the frontend uses the new backend logic.
- The current admin page still has legacy fallback support, but you should remove old plain-text passwords once the secure version is working.

## Recommended Next Step

After this upgrade, the next best improvement is moving exam settings out of browser `localStorage` and into the `Settings` sheet or Apps Script responses so all devices use the same configuration.
