# Direct server deployment

The current deployment target is an Ubuntu server with Nginx serving
`frontend/dist` and proxying `/api/` to the backend on `127.0.0.1:3001`.

- `knowing-doing.service` runs the compiled backend as the `ubuntu` user.
- `nginx-knowing-doing.conf` serves the SPA and forwards API requests.
- `backend.env.example` documents the non-secret runtime settings. The real
  environment file belongs at `/etc/knowing-doing/backend.env` on the server.

The frontend is built with `VITE_API_MODE=mock` until the MySQL and model
credentials are configured. This keeps the overview, new-plan and roadmap
pages viewable while the backend remains available for the next integration
step.
