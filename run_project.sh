#!/bin/bash
# Activate virtual environment
source .venv/bin/activate

# Run FastAPI with Uvicorn (excluding data dir from reloads to prevent interrupted uploads)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 --reload-exclude "data/*"
