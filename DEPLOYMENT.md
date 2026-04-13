# Deployment Guide: Google Cloud Run

This guide explains how to deploy the Real-time Chat application as a containerized service on Google Cloud Run.

## Prerequisites
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and initialized.
- [Docker](https://www.docker.com/products/docker-desktop) installed.
- A Google Cloud Project with billing enabled.
- A MongoDB instance (e.g., [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)) with a connection string.

## 1. Enable Required APIs
```bash
gcloud services enable run.googleapis.com \
    containerregistry.googleapis.com \
    artifactregistry.googleapis.com
```

## 2. Set Up Environment Variables
Create a `.env.production` file (or set them in your shell):
```bash
PROJECT_ID="your-project-id"
REGION="us-central1"
MONGO_URI="your-mongodb-atlas-uri"
GEMINI_API_KEY="your-gemini-api-key"
```

## 3. Containerize and Push to Artifact Registry

### Create a Repository
```bash
gcloud artifacts repositories create chat-app \
    --repository-format=docker \
    --location=$REGION
```

### Build and Push Server
```bash
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/server ./server
docker push $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/server
```

### Build and Push Client
> [!IMPORTANT]
> You must provide the Server's URL to the client build process. If you haven't deployed the server yet, you may need to deploy it first to get its URL.

```bash
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/client \
    --build-arg VITE_API_URL="https://server-url-from-cloud-run" ./client
docker push $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/client
```

## 4. Deploy to Cloud Run

### Deploy Server
```bash
gcloud run deploy chat-server \
    --image $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/server \
    --set-env-vars MONGO_URI=$MONGO_URI,GEMINI_API_KEY=$GEMINI_API_KEY \
    --allow-unauthenticated \
    --platform managed \
    --region $REGION
```
Note the Service URL provided after deployment.

### Deploy Client
```bash
gcloud run deploy chat-client \
    --image $REGION-docker.pkg.dev/$PROJECT_ID/chat-app/client \
    --allow-unauthenticated \
    --platform managed \
    --region $REGION
```

## Local Testing with Docker Compose
To test the entire stack locally in containers:
```bash
# Set your Gemini key for the compose session
export GEMINI_API_KEY=your_key_here
docker-compose up --build
```
The app will be available at `http://localhost`.

## Security Note
For production, it is highly recommended to use **Google Cloud Secret Manager** to store `MONGO_URI` and `GEMINI_API_KEY` instead of passing them as plain environment variables.
