FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Install system dependencies
RUN apt-get update \
    && apt-get install -y gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose the port (Render will override this, but good to have)
EXPOSE 8000

# Ensure data directory exists
RUN mkdir -p data

# Start FastAPI with shell form to support $PORT
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
