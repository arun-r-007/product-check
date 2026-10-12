# Use official Microsoft Playwright image with all Chromium OS dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.52.0-jammy

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install npm dependencies
RUN npm install --omit=dev

# Copy project source files
COPY . .

# Set environment variables for production headless execution
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PORT=3000

# Expose local server and webhook port
EXPOSE 3000

# Start the continuous Flipkart product monitor
CMD ["npm", "start"]
