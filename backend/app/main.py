from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FocusPad API")

# Allow local development from both localhost and 127.0.0.1 on any port.
# Browsers treat these hosts differently for CORS, so we use a regular
# expression that accepts either host with an optional port. This lets the
# React dev server (`npm run dev` on 5173) as well as Vite preview (4173) work
# without triggering CORS errors.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/ping")
async def ping():
    return {"msg": "pong"}
