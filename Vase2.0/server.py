"""Local Vase 2.0 studio. No third-party dependencies. Run: python3 server.py"""
import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
CONTROLS = ('presence', 'openness', 'expression', 'approach', 'release', 'stance', 'grounding', 'center', 'reserve', 'foundation', 'complexity', 'reach', 'curiosity', 'variation')
COLORS = ('cobalt', 'vermilion', 'forest', 'violet', 'ochre', 'black')
STATUSES = ('saved', 'queued', 'plotted', 'delivered')

def validate_record(record):
    if not isinstance(record, dict) or record.get('schemaVersion') != 1 or record.get('generatorVersion') != '2.2.0':
        raise ValueError('Unsupported vase record version.')
    state = record.get('state')
    if not isinstance(state, dict):
        raise ValueError('Missing vase state.')
    for key in CONTROLS:
        value = state.get(key)
        if type(value) not in (int, float) or not 0 <= value <= 1:
            raise ValueError(f'Invalid {key}.')
    if type(state.get('seed')) is not int or not 0 <= state['seed'] <= 0xffffffff:
        raise ValueError('Invalid seed.')
    if state.get('color') not in COLORS or type(state.get('growth')) is not bool:
        raise ValueError('Invalid palette or growth setting.')
    name = record.get('name')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
        raise ValueError('Please enter a name between 1 and 60 characters.')
    drawing = record.get('svg')
    if not isinstance(drawing, str) or len(drawing) > 150000 or '<!DOCTYPE' in drawing or '<!ENTITY' in drawing:
        raise ValueError('Invalid SVG drawing.')
    try:
        root = ET.fromstring(drawing)
        allowed = {'svg', 'title', 'g', 'path', 'line', 'circle', 'metadata'}
        allowed_attributes = {'xmlns', 'width', 'height', 'viewBox', 'role', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'id', 'd', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r'}
        if root.tag != '{http://www.w3.org/2000/svg}svg':
            raise ValueError('Invalid SVG root.')
        for element in root.iter():
            if element.tag.rsplit('}', 1)[-1] not in allowed or any(attribute not in allowed_attributes for attribute in element.attrib):
                raise ValueError('The drawing contains unsupported SVG elements.')
            if any('url(' in value.lower() for value in element.attrib.values()):
                raise ValueError('External SVG references are not supported.')
    except ET.ParseError as error:
        raise ValueError('Invalid SVG drawing.') from error
    return {**record, 'id': 'WB-' + uuid4().hex[:12].upper(), 'name': name.strip(),
            'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'saved'}

class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, data, status=200):
        payload = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        # Restrict mutations to same-origin browser requests or local CLI calls.
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            raise ValueError('Cross-origin writes are not allowed.')
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise ValueError('Cross-site writes are not allowed.')
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 300000:
            raise ValueError('Vase records must be smaller than 300 KB.')
        return json.loads(self.rfile.read(size))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/health':
            return self.reply({'service': 'ways-of-being', 'version': '2.2.0'})
        if path == '/api/vases':
            with sqlite3.connect(self.server.database) as connection:
                rows = connection.execute('SELECT record FROM vases ORDER BY created_at DESC').fetchall()
            return self.reply([json.loads(row[0]) for row in rows])
        # Only publish app assets; never the database, source, tests, or backups.
        if path not in ('/', '/index.html', '/app.js', '/geometry.mjs', '/style.css', '/favicon.svg'):
            return self.reply({'error': 'Not found.'}, 404)
        return super().do_GET()

    def do_HEAD(self):
        if urlparse(self.path).path not in ('/', '/index.html', '/app.js', '/geometry.mjs', '/style.css', '/favicon.svg'):
            return self.reply({'error': 'Not found.'}, 404)
        return super().do_HEAD()

    def do_POST(self):
        if self.path != '/api/vases':
            return self.reply({'error': 'Not found.'}, 404)
        try:
            record = validate_record(self.body())
            with sqlite3.connect(self.server.database) as connection:
                connection.execute('INSERT INTO vases VALUES (?, ?, ?)', (record['id'], record['createdAt'], json.dumps(record, allow_nan=False)))
            self.reply(record, 201)
        except (ValueError, TypeError, KeyError) as error:
            self.reply({'error': str(error)}, 400)

    def do_PATCH(self):
        match = re.fullmatch(r'/api/vases/(WB-[A-F0-9]{12})', self.path)
        if not match:
            return self.reply({'error': 'Not found.'}, 404)
        try:
            body = self.body()
            if not isinstance(body, dict) or body.get('status') not in STATUSES:
                raise ValueError('Invalid plot status.')
            with sqlite3.connect(self.server.database) as connection:
                row = connection.execute('SELECT record FROM vases WHERE id=?', (match[1],)).fetchone()
                if not row:
                    return self.reply({'error': 'Vase not found.'}, 404)
                record = json.loads(row[0]); record['status'] = body['status']
                record['updatedAt'] = datetime.now(timezone.utc).isoformat()
                connection.execute('UPDATE vases SET record=? WHERE id=?', (json.dumps(record), match[1]))
            self.reply(record)
        except (ValueError, TypeError) as error:
            self.reply({'error': str(error)}, 400)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--database', type=Path, default=ROOT / 'data' / 'vases.sqlite3')
    args = parser.parse_args()
    args.database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.database) as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS vases (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL)')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), StudioHandler)
    server.database = args.database
    print(f'Vase 2.0 is running at http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()

if __name__ == '__main__':
    main()
