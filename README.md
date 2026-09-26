# PulseLink

A live website where the admin can send text, images and videos, and users can message the admin.

## Features

- User chat with the admin (text + photo + video)
- Admin inbox with per-user threads
- Admin broadcasts that appear in every user’s feed
- Real-time updates with Socket.io
- Uploads stored in `public/uploads`

## Run it

```bash
cd pulselink
npm install
npm start
```

Open http://localhost:3000

- **User:** choose a display name
- **Admin password:** `admin123`  
  Override with `ADMIN_PASSWORD=secret npm start`

## GitHub

This is a Node.js app, not a static GitHub Pages site. Pages cannot run live chat or file uploads.

1. Create a GitHub repo and upload this folder.
2. Test on your computer with `npm install` then `npm start`.
3. To put it online, connect the repo to Render, Railway, or Fly.io and set `ADMIN_PASSWORD`.

Keep the `data/` folder if you want messages to persist across restarts.
