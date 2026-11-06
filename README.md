# Sky Hop

Sky Hop is a browser-based Flappy Bird-style game with an owner dashboard. The production backend uses Neon PostgreSQL for application data and Neon Object Storage for the four creator-selected default assets.

## Features

- Creator-selected character image, game-over image, flap sound, and collision sound.
- Public visitors receive the creator's default assets.
- Visitors can unlock local customisation by entering an owner-issued key.
- Private `/admin` login for managing defaults and visitor keys.
- PostgreSQL stores admin credentials, sessions, asset metadata, app settings, and the visitor-key hash.
- Neon Object Storage stores uploaded images and sounds. The bucket is `skyhop-assets` and uses `public_read` so the browser can fetch the selected defaults.
- Visitor-uploaded custom assets remain local to that visitor's browser; they do not replace the creator defaults.
- Mobile double-tap page zoom is suppressed while normal scrolling and pinch zoom remain available.

## Configure local development

Use Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with the pooled Neon connection string, Neon Object Storage S3 credentials, admin username/password, and a random `APP_SECRET_KEY`.

Generate an application secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Keep `.env` private. It is excluded by `.gitignore`.

Run the application:

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open:

- Game: http://127.0.0.1:8000
- Admin: http://127.0.0.1:8000/admin
- Health: http://127.0.0.1:8000/api/health

On first startup, the application creates the admin login from `ADMIN_USERNAME` and `ADMIN_PASSWORD`, and creates the required tables in Neon. The password hash is stored in PostgreSQL. Changing the environment variable later does not reset an existing admin password.

## Neon infrastructure

- Project: `sky-hop`
- Region: `aws-ap-southeast-1` (Singapore)
- Branch: `production`
- Database: `skyhop`
- Role: `skyhop_app`
- Neon project ID: `morning-glade-02291952`
- Production branch ID: `br-damp-salad-a1wu3g67`
- Object Storage bucket: `skyhop-assets` (`public_read`)
- S3 endpoint: `https://br-damp-salad-a1wu3g67.storage.c-1.ap-southeast-1.aws.neon.tech`

The app uses the pooled `DATABASE_URL` for normal web requests. The backend uses `boto3` with the Neon S3 endpoint and a scoped `storage:write` credential. Store all credential values only in local `.env` or Render environment variables; never commit them.

## Admin workflow

1. Sign in at `/admin` using the environment-configured admin username/password.
2. Upload or replace the four default assets.
3. Select **Generate new key** and copy the key. It is shown only once.
4. Share that key privately with visitors who may customise their own browser session.
5. Generate another key to invalidate the previous key, or revoke the key to lock customisation for everyone.

Visitor keys expire after 24 hours once exchanged for an access token. The server stores only a salted PBKDF2-SHA256 hash of the visitor key. Access tokens are HMAC-signed and tied to a key generation stored in Postgres, so rotating or revoking the key invalidates outstanding tokens.

## Deploy on Render

Deploy this project as a **Python Web Service** from the `admin-backend` branch. The Blueprint in `render.yaml` uses the Free plan and does not require a persistent Render disk because PostgreSQL and uploaded assets live in Neon.

Render will ask you to supply:

- `DATABASE_URL`
- `AWS_ENDPOINT_URL_S3`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` (at least 12 characters)

The Blueprint generates `APP_SECRET_KEY`. The bucket name and AWS region are already set in the Blueprint.

The app's root route and `/admin` are served by FastAPI. Keep your previous Render Static Site until the new web service has passed its health check and browser tests. Then you can decide whether to keep or retire the static site.

## Security notes

- Never commit `.env` or place admin passwords, visitor keys, database URLs, or S3 credentials in JavaScript.
- Admin passwords and visitor keys are PBKDF2-SHA256 hashed with random salts.
- Admin sessions use an HttpOnly, SameSite=Strict cookie.
- Login and visitor-key attempts are rate-limited in-process. For multi-instance scaling, move rate limiting to a shared store.
- Upload endpoints validate allowed extensions, size limits, and file signatures.
- The S3 credential is server-side only. The bucket permits public reads, but only the server's scoped credential can write or delete objects.
- A browser-only game cannot prevent a technically capable visitor from modifying their own page with developer tools. The key gate controls the normal UI and server-issued access token; it is not DRM.
