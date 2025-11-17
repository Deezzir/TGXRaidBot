# Use an official Node.js runtime as the parent image
FROM node:24-slim

# Set the working directory in the container to /app
WORKDIR /app

# Add the current directory contents into the container at /app
ADD . /app

# Install application dependencies
RUN npm install

# Run the application
CMD ["npm", "run", "start"]
