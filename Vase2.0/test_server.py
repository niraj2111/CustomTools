import copy
import json
import tempfile
import unittest
from pathlib import Path
from server import validate_record

class RecordTests(unittest.TestCase):
    def setUp(self):
        self.record = {'schemaVersion':1,'generatorVersion':'2.2.0','name':'Vase 01','state':{'presence':.5,'openness':.5,'expression':.5,'approach':.5,'release':.5,'stance':.5,'grounding':.5,'center':.5,'reserve':.5,'foundation':.5,'complexity':.5,'reach':.5,'curiosity':.5,'variation':.5,'seed':42,'growth':False,'color':'cobalt'},'svg':'<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="210mm"><g fill="none"><path d="M10 10L20 20"/><line x1="10" y1="10" x2="20" y2="20"/><circle cx="20" cy="20" r="0.75"/></g></svg>'}

    def test_record_state_preserved_with_server_identity(self):
        result=validate_record(self.record)
        self.assertEqual(result['state'],self.record['state'])
        self.assertEqual(result['svg'],self.record['svg'])
        self.assertRegex(result['id'],r'^WB-[A-F0-9]{12}$')
        self.assertEqual(result['status'],'saved')
        self.assertNotEqual(result['id'],validate_record(self.record)['id'])

    def test_invalid_ranges_and_nonfinite_values(self):
        for value in [-1,1.01,float('nan'),float('inf'),'0.5',True,None]:
            with self.subTest(value=value):
                record=copy.deepcopy(self.record);record['state']['presence']=value
                with self.assertRaises(ValueError):validate_record(record)

    def test_bad_version_color_seed_and_title(self):
        for field,value in [('generatorVersion','future'),('name','   '),('name','x'*61)]:
            record=copy.deepcopy(self.record);record[field]=value
            with self.assertRaises(ValueError):validate_record(record)
        for field,value in [('color','#ffffff'),('seed',-1),('seed',2**32),('growth','true')]:
            record=copy.deepcopy(self.record);record['state'][field]=value
            with self.assertRaises(ValueError):validate_record(record)

    def test_unsafe_or_invalid_svg_rejected(self):
        for svg in ['broken','<svg/>','<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>','<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.com)"/></svg>']:
            record=copy.deepcopy(self.record);record['svg']=svg
            with self.assertRaises(ValueError):validate_record(record)

    def test_sqlite_roundtrip(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'test.sqlite3'
            record=validate_record(self.record)
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE vases (id TEXT PRIMARY KEY, record TEXT)')
                db.execute('INSERT INTO vases VALUES (?,?)',(record['id'],json.dumps(record)))
            with sqlite3.connect(path) as db:
                restored=json.loads(db.execute('SELECT record FROM vases').fetchone()[0])
            self.assertEqual(restored,record)

if __name__=='__main__':unittest.main()
