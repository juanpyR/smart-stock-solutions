FROM nginx:1.25-alpine

COPY . /usr/share/nginx/html

# Custom nginx config to reverse proxy API requests
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
