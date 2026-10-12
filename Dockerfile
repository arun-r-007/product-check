# Use official Microsoft Playwright v1.64.0 image with all Chromium OS dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.64.0-jammy

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
ENV PORT=3001

# Expose local server and webhook port
EXPOSE 3001

# Start the continuous Flipkart product monitor
CMD ["npm", "start"]
