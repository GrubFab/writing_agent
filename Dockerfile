FROM python:3.12-slim

WORKDIR /app

# Install git for vault auto-commits & curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN pip install --no-cache-dir -e .

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV WRITING_AGENT_VAULT=/vault
ENV LM_STUDIO_BASE_URL=http://host.docker.internal:1234/v1

CMD ["python", "app.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
