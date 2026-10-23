# Science of Gifts Writing Studio

A sophisticated editorial writing studio tailored for **Science of Gifts**. Features rich-text editing (powered by TipTap/ProseMirror), structured project outlines, style guide controls, AI-powered Editorial Reviews, Quality Control fact-checking, and research management.

---

## Architecture Overview

The application is structured for dual-environment execution:

1. **Frontend**: Vite + React + Tailwind CSS + TipTap editor located in `src/`.
2. **Local Backend (`server.ts`)**: Express server providing Gemini AI proxies, PDF parsing, research extraction, and local development endpoints.
3. **Cloudflare Production Edge (`worker/`)**: Serverless Cloudflare Worker (`writing-studio-api`) handling AI Editorial Review, Quality Control, Style Analysis, and Research endpoints securely without exposing API keys to the browser.

---

## 1. Prerequisites & Environment Setup

- **Node.js**: v18.x or v20.x or higher
- **npm**: v9.x or higher
- **Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)
- **Cloudflare Account & Wrangler CLI**: Free Cloudflare account for worker/pages hosting

---

## 2. GitHub Deployment

Follow these steps to publish your codebase to GitHub:

### Step 1: Initialize Git Repository
```bash
# Initialize git if not already present
git init

# Verify .gitignore exists and excludes sensitive files (.env, node_modules, dist)
git status
```

### Step 2: Commit Code
```bash
git add .
git commit -m "Initial commit of Science of Gifts Writing Studio"
```

### Step 3: Connect and Push to GitHub
```bash
# Create a new repository on GitHub (e.g. "writing-studio")
# Link remote repository
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/writing-studio.git
git branch -M main
git push -u origin main
```

---

## 3. Deploying to Cloudflare

Deployment consists of two simple steps: deploying the **API Worker** and deploying the **Frontend Application**.

### A. Deploy the API Worker (`writing-studio-api`)

The API worker runs serverless edge functions for Gemini AI editorial workflows.

1. **Authenticate Wrangler with Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Navigate to the `worker/` directory**:
   ```bash
   cd worker
   ```

3. **Install Worker dependencies**:
   ```bash
   npm install
   ```

4. **Set the Gemini API Key Secret in Cloudflare**:
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```
   *When prompted, paste your Google Gemini API key.*

5. **Deploy the Worker**:
   ```bash
   npx wrangler deploy
   ```

6. **Copy your Worker URL**:
   After deployment, Wrangler will print your Worker URL, for example:
   `https://writing-studio-api.YOUR-SUBDOMAIN.workers.dev`

7. **Return to the root directory**:
   ```bash
   cd ..
   ```

---

### B. Deploy the Frontend Application (`writing-studio`)

You can deploy the frontend using **Cloudflare Pages** (via GitHub auto-deploy) or **Wrangler CLI**.

#### Option 1: Cloudflare Pages Dashboard + GitHub (Recommended for Continuous Deployment)

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Select your `writing-studio` GitHub repository.
3. Configure the Build settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Environment Variables:
   - Click **Add variable**:
     - `VITE_GEMINI_API_URL` = `https://writing-studio-api.YOUR-SUBDOMAIN.workers.dev` (the Worker URL from Step A.6)
5. Click **Save and Deploy**.

#### Option 2: Wrangler CLI Deployment

1. Set the worker URL in `.env.production` (or as an environment variable):
   ```bash
   # Create or edit .env.production
   VITE_GEMINI_API_URL="https://writing-studio-api.YOUR-SUBDOMAIN.workers.dev"
   ```

2. Build the production static bundle:
   ```bash
   npm run build
   ```

3. Deploy static assets to Cloudflare:
   ```bash
   npx wrangler deploy --name writing-studio --assets ./dist --compatibility-date 2025-01-09
   ```

---

## 4. Local Development

To run the application locally with Express and hot reloading:

1. Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY="your_actual_gemini_api_key_here"
   ```

2. Start the local server:
   ```bash
   npm run dev
   ```

3. Open your browser at `http://localhost:3000`.

---

## 5. How to Update & Redeploy in the Future

Whenever you make improvements or updates to the application:

### Step 1: Push updates to GitHub
```bash
git add .
git commit -m "Describe your updates here"
git push origin main
```

### Step 2: Redeploy Updates

#### If updating the Frontend:
- If connected to Cloudflare Pages via GitHub, Cloudflare will **automatically build and deploy** your changes upon git push.
- If using Wrangler CLI:
  ```bash
  npm run build
  npx wrangler deploy --name writing-studio --assets ./dist --compatibility-date 2025-01-09
  ```

#### If updating the API Worker (`worker/src/`):
```bash
cd worker
npx wrangler deploy
cd ..
```

---

## Troubleshooting

- **429 / Quota Exceeded**: If the Gemini API returns quota errors, verify your API key in Cloudflare Worker secrets (`npx wrangler secret put GEMINI_API_KEY` inside `/worker`).
- **CORS Issues**: The Cloudflare Worker includes CORS headers (`Access-Control-Allow-Origin: *`). Ensure `VITE_GEMINI_API_URL` points directly to your worker URL without trailing slashes.
- **Missing API URL**: Check browser console logs. If `VITE_GEMINI_API_URL` is empty in production, verify your Cloudflare Pages environment variables.
