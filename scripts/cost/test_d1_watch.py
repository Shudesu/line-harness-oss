import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('watch',pathlib.Path(__file__).with_name('d1-watch.py'))
watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)

class WatchTest(unittest.TestCase):
    def test_missing_is_not_zero(self):
        self.assertEqual(watch.evaluate(None,[],1500,None)['status'],'unknown')
        self.assertEqual(watch.evaluate({'rowsRead':None,'rowsWritten':0},[],1500,None)['status'],'unknown')
    def test_absent_wallet_is_unmeasured(self):
        r=watch.evaluate({'rowsRead':10,'rowsWritten':1},[],1500,None)
        self.assertIsNone(r['walletRowsPerExecution']);self.assertFalse(r['budgetConfigured'])
    def test_cost_regression_and_budget(self):
        r=watch.evaluate({'rowsRead':4000,'rowsWritten':1},[{'count':2,'sum':{'rowsRead':4000}}],1500,3000)
        self.assertEqual(r['alerts'],['account_hourly_read_budget','wallet_rows_per_execution'])
    def test_truncation_is_unknown(self):
        self.assertEqual(watch.evaluate({'rowsRead':1,'rowsWritten':0},[{}]*100,1500,None)['status'],'unknown')
    def test_cheap_queries_do_not_hide_expensive_group(self):
        r=watch.evaluate({'rowsRead':20000,'rowsWritten':0},[{'count':1000,'sum':{'rowsRead':1000}}, {'count':1,'sum':{'rowsRead':19000}}],1500,None)
        self.assertEqual(r['status'],'alert')
    def test_malformed_wallet_is_unknown(self):
        self.assertEqual(watch.evaluate({'rowsRead':1,'rowsWritten':0},[{'count':None}],1500,None)['status'],'unknown')

if __name__=='__main__': unittest.main()
