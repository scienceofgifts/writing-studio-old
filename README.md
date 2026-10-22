# Science of Gifts Writing Studio

A sophisticated editorial writing studio tailored for **Science of Gifts**. Features rich-text editing (powered by TipTap/ProseMirror), structured project outlines, style guide controls, AI-powered Editorial Reviews, Quality Control fact-checking, and research management.

---

## Architecture Overview

The application uses a unified full-stack architecture powered by **Cloudflare Pages**:

1. **Frontend**: Vite + React + Tailwind CSS + TipTap editor located in `src/`.
2. **Native Edge API Functions**: Catch-all Cloudflare Pages Function at `functions/api/[[route]].ts` handling all `/api/*` endpoints (Gemini AI actions, editorial review, quality control, outline generation, PDF parsing with `unpdf`, and research metadata lookup).
3. **Local Development (`server.ts`)**: Express + Vite middleware server providing local API endpoints and Vite dev server in a single process.

All API requests default to relative same-origin calls (`/api/...`), removing the need for a separate worker deployment or CORS configuration.

---

## 1. Prerequisites & Environment Setup

- **Node.js**: v18.x, v20.x, or higher
- **npm**: v9.x or higher
- **Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)
- **Cloudflare Account & Wrangler CLI**: For deploying to Cloudflare Pages

---

## 2. Local Development

To run the application locally:

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

## 3. GitHub Deployment

Follow these steps to publish your codebase to GitHub:

```bash
# Initialize git if not already present
git init

# Commit code
git add .
git commit -m "Initial commit of Science of Gifts Writing Studio"

# Connect and push to GitHub
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/writing-studio.git
git branch -M main
git push -u origin main
```

---

## 4. Single-Step Deployment to Cloudflare Pages

### Option 1: Cloudflare Pages Dashboard + GitHub (Recommended)

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Select your `writing-studio` GitHub repository.
3. Configure the Build settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Set Secret Environment Variable:
   - Go to **Settings** > **Environment variables** > **Add variable**.
   - Add `GEMINI_API_KEY` with your Gemini API key value.
5. Click **Save and Deploy**.

Cloudflare automatically detects the `functions/` directory and builds both the static assets and native Pages Functions!

### Option 2: Wrangler CLI Deployment

1. **Authenticate Wrangler with Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Build the production bundle**:
   ```bash
   npm run build
   ```

3. **Deploy to Cloudflare Pages**:
   ```bash
   npx wrangler pages deploy dist --project-name writing-studio
   ```

4. **Set the Gemini API Key Secret in Cloudflare Pages**:
   ```bash
   npx wrangler pages secret put GEMINI_API_KEY --project-name writing-studio
   ```
   *When prompted, paste your Google Gemini API key.*

---

## 5. How to Update & Redeploy in the Future

Whenever you make improvements or updates:

```bash
git add .
git commit -m "Describe your updates here"
git push origin main
```

If connected to Cloudflare Pages via GitHub, Cloudflare will **automatically build and deploy** your changes upon git push.

For manual Wrangler CLI deployments:
```bash
npm run build
npx wrangler pages deploy dist --project-name writing-studio
```

---

## Troubleshooting

- **API Fallbacks**: If `GEMINI_API_KEY` is not provided or API quota is exceeded, the Pages Functions automatically return rich heuristic editorial responses without crashing.
- **Secrets Check**: Verify your key is set using `npx wrangler pages secret list --project-name writing-studio`.

