  # Upstreams are resolved at request time through Docker's DNS, so the shared nginx starts and reloads
  # even while the crew stack is down (requests then get 502 until it is back).
  resolver 127.0.0.11 valid=30s ipv6=off;
  resolver_timeout 5s;
  set $crew_api_upstream http://crew-api:8787;
  set $crew_web_upstream http://crew-web:8080;

  # API, including the SSE streams /v1/stream and /v1/daemon/stream: no buffering, no cache, long reads.
  # The API also sends "X-Accel-Buffering: no" on event streams; nginx honours it and does not forward it.
  location /v1/ {
    proxy_pass $crew_api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    gzip off;
    # Docs snapshots are up to 2 MB of JSON (the API's body limit).
    client_max_body_size 4m;
  }

  # Everything else is the SPA; crew-web falls back to index.html for client-side routes.
  location / {
    proxy_pass $crew_web_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
