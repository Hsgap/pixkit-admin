#!/usr/bin/env python3
"""
PixKit Fleet Admin Command Center — Realtime Dedicated Server
Serves the Admin Panel, handles ecosystem state persistence, cross-app CORS sync,
and supporter database management.
"""

import sys
import os
import json
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3001
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config', 'ecosystem-state.json')
SUPPORTERS_FILE = os.path.join(BASE_DIR, 'config', 'supporters.json')

# Ensure config directory exists
os.makedirs(os.path.join(BASE_DIR, 'config'), exist_ok=True)

# Initialize supporters file if missing
if not os.path.exists(SUPPORTERS_FILE):
    with open(SUPPORTERS_FILE, 'w') as f:
        json.dump([], f, indent=2)

class PixKitAdminHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS for cross-app local dev and mobile Capacitor sync
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Pin')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path == '/admin':
            self.path = '/index.html'

        # API: Get Ecosystem State
        if self.path.startswith('/api/status'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            try:
                with open(CONFIG_FILE, 'r') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return

        # API: Get Supporters
        if self.path.startswith('/api/supporters'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            try:
                with open(SUPPORTERS_FILE, 'r') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps([]).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        # API: Update Ecosystem State
        if self.path == '/api/status':
            try:
                data = json.loads(body.decode('utf-8'))
                data.setdefault('system', {})
                data['system']['lastUpdated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
                with open(CONFIG_FILE, 'w') as f:
                    json.dump(data, f, indent=2)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "updated": data['system']['lastUpdated']}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        # API: Save Supporters List
        if self.path == '/api/supporters':
            try:
                supporters = json.loads(body.decode('utf-8'))
                with open(SUPPORTERS_FILE, 'w') as f:
                    json.dump(supporters, f, indent=2)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "count": len(supporters)}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run():
    server_address = ('0.0.0.0', PORT)
    httpd = HTTPServer(server_address, PixKitAdminHandler)
    print(f"🚀 PixKit Fleet Admin Server live at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAdmin server stopped.")
        httpd.server_close()

if __name__ == '__main__':
    run()

