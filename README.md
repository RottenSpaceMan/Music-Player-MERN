# Music Player MERN

Minimal MERN stack app that imports audio files into MongoDB and streams them through a small React client.

## Quick start

1. Backend
   - `cd Backend`
   - `npm install`
   - `npm start`
2. Frontend
   - `cd Frontend`
   - `npm install`
   - `npm run dev`

Default login is `admin` / `password`. If the API does not live at `http://localhost:4000`, create `Frontend/.env` with `VITE_API_URL="http://your-host:4000"`.

Optional environment variables for the backend:
- `MONGO_URI`
- `JWT_SECRET`
- `MUSIC_LIBRARY_DIR`
