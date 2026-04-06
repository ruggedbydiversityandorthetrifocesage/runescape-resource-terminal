FROM oven/bun:1-alpine

# Install Node.js (for Puppeteer launcher) + Chromium
RUN apk add --no-cache \
    nodejs \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to use system Chromium (not download its own)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy everything (node_modules excluded via .dockerignore)
COPY . .

# Install dependencies including puppeteer
RUN bun add puppeteer && bun install

RUN chmod +x start.sh

EXPOSE 3001

# start.sh: launches headless browsers first, then dashboard
CMD ["sh", "start.sh"]
