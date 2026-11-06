# Sky Hop

Sky Hop is a browser-based Flappy Bird-style game with an owner dashboard. The production backend uses Neon PostgreSQL for application data and Neon Object Storage for the four creator-selected default assets.

## Features

- Creator-selected character image, game-over image, flap sound, and collision sound.
- Public visitors receive the creator's default assets.
- Private `/admin` login for managing the four default assets.
- PostgreSQL stores admin credentials, sessions, asset metadata, and app settings.
- Neon Object Storage stores uploaded images and sounds. The bucket is `skyhop-assets` and uses `public_read` so the browser can fetch the selected defaults.
- Public visitors cannot upload or change assets. They simply play using the creator-selected defaults.
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

The `APP_SECRET_KEY` is only an internal server secret used to protect the administrator login session. It is not a visitor access code. Render generates it automatically from the Blueprint. For local development, generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Keep `.env` private. It is excluded by `.gitignore`. Visitors never need a token, key, or login.

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

1. Visit `/admin` and sign in with the configured administrator credentials.
2. Upload or replace the friend face cutout, game-over image, flap sound, and collision sound.
3. Adjust game-over image opacity and save.
4. Visitors do not have upload controls or need access keys. They simply play with the current creator defaults.

For the character, use a transparent PNG cutout where possible. The game renders the uploaded image as-is, preserving its aspect ratio and transparency. It does not crop the image into a circle or remove backgrounds automatically.

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

- Never commit `.env` or place admin passwords, database URLs, or S3 credentials in JavaScript.
- Admin passwords are PBKDF2-SHA256 hashed with random salts.
- Admin sessions use an HttpOnly, SameSite=Strict cookie.
- Admin login attempts are rate-limited in-process. For multi-instance scaling, move rate limiting to a shared store.
- Upload endpoints validate allowed extensions, size limits, and file signatures.
- The S3 credential is server-side only. The bucket permits public reads, but only the server's scoped credential can write or delete objects.
- Public visitors have no asset-management endpoints. Only requests with a valid admin session can upload, replace, or delete creator assets.
