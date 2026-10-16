"""Small regression checks for real courtyard openings and model alignment."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class LandmarkGeometryTests(unittest.TestCase):
    def test_courtyard_and_world_alignment(self):
        path = ROOT / 'scripts' / 'landmark_geometry.py'
        self.assertTrue(path.exists(), 'landmark geometry with courtyard support is missing')
        spec = importlib.util.spec_from_file_location('landmark_geometry', path)
        geo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(geo)
        outer = [(100,200),(140,200),(140,240),(100,240)]
        hole = [(110,210),(130,210),(130,230),(110,230)]
        self.assertTrue(geo.contains((105,205), outer, [hole]))
        self.assertFalse(geo.contains((120,220), outer, [hole]))
        self.assertFalse(geo.contains((90,220), outer, [hole]))
        origin, rings = geo.local_rings(outer, [hole])
        self.assertEqual(origin, (120,220))
        self.assertIn((-10,-10), rings[1])
        self.assertLess(geo.signed_area(rings[1]), 0)
        self.assertEqual((rings[0][0][0]+origin[0], rings[0][0][1]+origin[1]), outer[0])
        self.assertEqual(geo.clean_ring([(0,0),(1,0),(1,1),(0,0)]), [(0,0),(1,0),(1,1)])


if __name__ == '__main__':
    unittest.main()
