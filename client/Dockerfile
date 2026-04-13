# Stage 1: Build the Vite app
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Pass the API URL at build time
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Copy the rest of the application code and build
COPY . .
RUN npm run build

# Stage 2: Serve the app with Nginx
FROM nginx:alpine

# Copy the build output from the builder stage to Nginx's html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy a custom Nginx config to handle SPA routing if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
