# Use Node.js LTS as the base image
FROM node:20-slim AS builder

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Final stage
FROM node:20-slim

WORKDIR /app

# Copy only the necessary files from the builder stage
COPY --from=builder /app .

# Expose the port the app runs on
EXPOSE 5000

# Start the server
CMD ["npm", "start"]
