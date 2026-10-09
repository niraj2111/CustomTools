import copy
import json
import tempfile
import unittest
from pathlib import Path
from server import validate_record


class RecordTests(unittest.TestCase):
    def setUp(self):
        controls = ('presence', 'openness', 'expression', 'approach', 'release', 'stance', 'grounding', 'center', 'reserve', 'foundation', 'complexity', 'reach', 'curiosity', 'variation')
        state = {key: 0.5 for key in controls}
        state.update({'seed': 42, 'growth': True, 'color': 'black'})
        self.record = {
            'schemaVersion': 2,
            'appVersion': '3.0.0',
            'geometryVersion': '2.3.1',
            'exerciseVersion': 'portrait-without-a-face-v1',
            'name': 'Workshop vase 01',
            'participant': 'P12',
            'filenameParticipant': 'P12',
            'final': True,
            'state': state,
            'workshop': {'fixedVaseHeightMM': 115, 'fixedCompositionHeightMM': 165, 'vaseLines': 80, 'selectedAt': '2026-10-09T10:00:00Z', 'candidateId': 'candidate-1'},
            'svg': '<svg xmlns="http://www.w3.org/2000/svg" width="148mm" height="210mm"><g fill="none"><path d="M10 10L20 20"/></g></svg>',
        }

    def test_final_record_preserved_with_server_identity(self):
        result = validate_record(self.record)
        self.assertEqual(result['state'], self.record['state'])
        self.assertTrue(result['final'])
        self.assertRegex(result['id'], r'^V3-[A-F0-9]{12}$')
        self.assertEqual(result['status'], 'saved')

    def test_requires_branch_fixed_height_and_line_count(self):
        for mutation in ('branch', 'height', 'lines'):
            record = copy.deepcopy(self.record)
            if mutation == 'branch':
                record['state']['growth'] = False
            elif mutation == 'height':
                record['workshop']['fixedVaseHeightMM'] = 160
            else:
                record['workshop']['vaseLines'] = 81
            with self.assertRaises(ValueError):
                validate_record(record)

    def test_rejects_unconfirmed_and_wrong_versions(self):
        for field, value in [('final', False), ('appVersion', '2.3.1'), ('geometryVersion', 'future'), ('exerciseVersion', 'other')]:
            record = copy.deepcopy(self.record)
            record[field] = value
            with self.assertRaises(ValueError):
                validate_record(record)

    def test_invalid_ranges_and_unsafe_svg(self):
        for value in [-1, 1.01, float('nan'), float('inf'), '0.5', True, None]:
            record = copy.deepcopy(self.record)
            record['state']['presence'] = value
            with self.assertRaises(ValueError):
                validate_record(record)
        for drawing in ['broken', '<svg/>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']:
            record = copy.deepcopy(self.record)
            record['svg'] = drawing
            with self.assertRaises(ValueError):
                validate_record(record)

    def test_sqlite_roundtrip(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.sqlite3'
            record = validate_record(self.record)
            with sqlite3.connect(path) as database:
                database.execute('CREATE TABLE vases (id TEXT PRIMARY KEY, record TEXT)')
                database.execute('INSERT INTO vases VALUES (?,?)', (record['id'], json.dumps(record)))
            with sqlite3.connect(path) as database:
                restored = json.loads(database.execute('SELECT record FROM vases').fetchone()[0])
            self.assertEqual(restored, record)


if __name__ == '__main__':
    unittest.main()
