# -*- coding: utf-8 -*-
# Created by makepy.py version 0.5.01
# By python version 3.14.4 (tags/v3.14.4:23116f9, Apr  7 2026, 14:10:54) [MSC v.1944 64 bit (AMD64)]
# From type library '{00062FFF-0000-0000-C000-000000000046}'
# On Tue Aug 18 12:12:46 2026
'Microsoft Outlook 16.0 Object Library'
makepy_version = '0.5.01'
python_version = 0x30e04f0

import win32com.client.CLSIDToClass, pythoncom, pywintypes
import win32com.client.util
from pywintypes import IID
from win32com.client import Dispatch

# The following 3 lines may need tweaking for the particular server
# Candidates are pythoncom.Missing, .Empty and .ArgNotFound
defaultNamedOptArg=pythoncom.Empty
defaultNamedNotOptArg=pythoncom.Empty
defaultUnnamedArg=pythoncom.Empty

CLSID = IID('{00062FFF-0000-0000-C000-000000000046}')
MajorVersion = 9
MinorVersion = 6
LibraryFlags = 8
LCID = 0x0

from win32com.client import DispatchBaseClass
class _Application(DispatchBaseClass):
	CLSID = IID('{00063001-0000-0000-C000-000000000046}')
	coclass_clsid = IID('{0006F03A-0000-0000-C000-000000000046}')

	# Result is of type _Explorer
	def ActiveExplorer(self):
		ret = self._oleobj_.InvokeTypes(273, LCID, 1, (9, 0), (),)
		if ret is not None:
			ret = Dispatch(ret, 'ActiveExplorer', '{00063003-0000-0000-C000-000000000046}')
		return ret

	# Result is of type _Inspector
	def ActiveInspector(self):
		ret = self._oleobj_.InvokeTypes(274, LCID, 1, (9, 0), (),)
		if ret is not None:
			ret = Dispatch(ret, 'ActiveInspector', '{00063005-0000-0000-C000-000000000046}')
		return ret

	def ActiveWindow(self):
		ret = self._oleobj_.InvokeTypes(287, LCID, 1, (9, 0), (),)
		if ret is not None:
			ret = Dispatch(ret, 'ActiveWindow', None)
		return ret

	# Result is of type Search
	def AdvancedSearch(self, Scope=defaultNamedNotOptArg, Filter=defaultNamedOptArg, SearchSubFolders=defaultNamedOptArg, Tag=defaultNamedOptArg):
		ret = self._oleobj_.InvokeTypes(64101, LCID, 1, (9, 0), ((8, 1), (12, 17), (12, 17), (12, 17)),Scope
			, Filter, SearchSubFolders, Tag)
		if ret is not None:
			ret = Dispatch(ret, 'AdvancedSearch', '{0006300B-0000-0000-C000-000000000046}')
		return ret

	def CopyFile(self, FilePath=defaultNamedNotOptArg, DestFolderPath=defaultNamedNotOptArg):
		ret = self._oleobj_.InvokeTypes(64098, LCID, 1, (9, 0), ((8, 1), (8, 1)),FilePath
			, DestFolderPath)
		if ret is not None:
			ret = Dispatch(ret, 'CopyFile', None)
		return ret

	def CreateItem(self, ItemType=defaultNamedNotOptArg):
		ret = self._oleobj_.InvokeTypes(266, LCID, 1, (9, 0), ((3, 1),),ItemType
			)
		if ret is not None:
			ret = Dispatch(ret, 'CreateItem', None)
		return ret

	def CreateItemFromTemplate(self, TemplatePath=defaultNamedNotOptArg, InFolder=defaultNamedOptArg):
		ret = self._oleobj_.InvokeTypes(267, LCID, 1, (9, 0), ((8, 1), (12, 17)),TemplatePath
			, InFolder)
		if ret is not None:
			ret = Dispatch(ret, 'CreateItemFromTemplate', None)
		return ret

	def CreateObject(self, ObjectName=defaultNamedNotOptArg):
		ret = self._oleobj_.InvokeTypes(277, LCID, 1, (9, 0), ((8, 1),),ObjectName
			)
		if ret is not None:
			ret = Dispatch(ret, 'CreateObject', None)
		return ret

	# Result is of type _NameSpace
	def GetNamespace(self, Type=defaultNamedNotOptArg):
		ret = self._oleobj_.InvokeTypes(272, LCID, 1, (9, 0), ((8, 1),),Type
			)
		if ret is not None:
			ret = Dispatch(ret, 'GetNamespace', '{00063002-0000-0000-C000-000000000046}')
		return ret

	def GetNewNickNames(self, pvar=defaultNamedNotOptArg):
		return self._oleobj_.InvokeTypes(64072, LCID, 1, (24, 0), ((16396, 1),),pvar
			)

	def GetObjectReference(self, Item=defaultNamedNotOptArg, ReferenceType=defaultNamedNotOptArg):
		ret = self._oleobj_.InvokeTypes(64470, LCID, 1, (9, 0), ((9, 1), (3, 1)),Item
			, ReferenceType)
		if ret is not None:
			ret = Dispatch(ret, 'GetObjectReference', None)
		return ret

	def IsSearchSynchronous(self, LookInFolders=defaultNamedNotOptArg):
		return self._oleobj_.InvokeTypes(64108, LCID, 1, (11, 0), ((8, 1),),LookInFolders
			)

	def Quit(self):
		return self._oleobj_.InvokeTypes(275, LCID, 1, (24, 0), (),)

	def RefreshFormRegionDefinition(self, RegionName=defaultNamedNotOptArg):
		return self._oleobj_.InvokeTypes(64639, LCID, 1, (24, 0), ((8, 1),),RegionName
			)

	_prop_map_get_ = {
		# Method 'AnswerWizard' returns object of type 'AnswerWizard'
		"AnswerWizard": (285, 2, (9, 0), (), "AnswerWizard", '{000C0360-0000-0000-C000-000000000046}'),
		# Method 'Application' returns object of type '_Application'
		"Application": (61440, 2, (9, 0), (), "Application", '{00063001-0000-0000-C000-000000000046}'),
		# Method 'Assistance' returns object of type 'IAssistance'
		"Assistance": (64520, 2, (9, 0), (), "Assistance", '{4291224C-DEFE-485B-8E69-6CF8AA85CB76}'),
		# Method 'Assistant' returns object of type 'Assistant'
		"Assistant": (276, 2, (9, 0), (), "Assistant", '{000C0322-0000-0000-C000-000000000046}'),
		# Method 'COMAddIns' returns object of type 'COMAddIns'
		"COMAddIns": (280, 2, (9, 0), (), "COMAddIns", '{000C0339-0000-0000-C000-000000000046}'),
		"Class": (61450, 2, (3, 0), (), "Class", None),
		# Method 'DataPrivacyOptions' returns object of type 'DataPrivacyOptions'
		"DataPrivacyOptions": (64676, 2, (9, 0), (), "DataPrivacyOptions", '{000C03D9-0000-0000-C000-000000000046}'),
		"DefaultProfileName": (64214, 2, (8, 0), (), "DefaultProfileName", None),
		# Method 'Explorers' returns object of type '_Explorers'
		"Explorers": (281, 2, (9, 0), (), "Explorers", '{0006300A-0000-0000-C000-000000000046}'),
		"FeatureInstall": (286, 2, (3, 0), (), "FeatureInstall", None),
		# Method 'Inspectors' returns object of type '_Inspectors'
		"Inspectors": (282, 2, (9, 0), (), "Inspectors", '{00063008-0000-0000-C000-000000000046}'),
		"IsTrusted": (64499, 2, (11, 0), (), "IsTrusted", None),
		# Method 'LanguageSettings' returns object of type 'LanguageSettings'
		"LanguageSettings": (283, 2, (9, 0), (), "LanguageSettings", '{000C0353-0000-0000-C000-000000000046}'),
		# Method 'MsoDebugOptions' returns object of type 'MsoDebugOptions'
		"MsoDebugOptions": (64673, 2, (9, 0), (), "MsoDebugOptions", '{000C035A-0000-0000-C000-000000000046}'),
		"Name": (12289, 2, (8, 0), (), "Name", None),
		"Parent": (61441, 2, (9, 0), (), "Parent", None),
		# Method 'PickerDialog' returns object of type 'PickerDialog'
		"PickerDialog": (64613, 2, (9, 0), (), "PickerDialog", '{000C03E6-0000-0000-C000-000000000046}'),
		"ProductCode": (284, 2, (8, 0), (), "ProductCode", None),
		# Method 'Reminders' returns object of type '_Reminders'
		"Reminders": (64153, 2, (9, 0), (), "Reminders", '{000630B1-0000-0000-C000-000000000046}'),
		# Method 'Session' returns object of type '_NameSpace'
		"Session": (61451, 2, (9, 0), (), "Session", '{00063002-0000-0000-C000-000000000046}'),
		# Method 'TimeZones' returns object of type 'TimeZones'
		"TimeZones": (64553, 2, (13, 0), (), "TimeZones", '{000610FC-0000-0000-C000-000000000046}'),
		"Version": (278, 2, (8, 0), (), "Version", None),
	}
	_prop_map_put_ = {
		"FeatureInstall": ((286, LCID, 4, 0),()),
	}
	def __iter__(self):
		"Return a Python iterator for this object"
		try:
			ob = self._oleobj_.InvokeTypes(-4,LCID,3,(13, 10),())
		except pythoncom.error:
			raise TypeError("This object does not support enumeration")
		return win32com.client.util.Iterator(ob, None)

win32com.client.CLSIDToClass.RegisterCLSID( "{00063001-0000-0000-C000-000000000046}", _Application )
# -*- coding: utf-8 -*-
# Created by makepy.py version 0.5.01
# By python version 3.14.4 (tags/v3.14.4:23116f9, Apr  7 2026, 14:10:54) [MSC v.1944 64 bit (AMD64)]
# From type library '{00062FFF-0000-0000-C000-000000000046}'
# On Tue Aug 18 12:12:46 2026
'Microsoft Outlook 16.0 Object Library'
makepy_version = '0.5.01'
python_version = 0x30e04f0

import win32com.client.CLSIDToClass, pythoncom, pywintypes
import win32com.client.util
from pywintypes import IID
from win32com.client import Dispatch

# The following 3 lines may need tweaking for the particular server
# Candidates are pythoncom.Missing, .Empty and .ArgNotFound
defaultNamedOptArg=pythoncom.Empty
defaultNamedNotOptArg=pythoncom.Empty
defaultUnnamedArg=pythoncom.Empty

CLSID = IID('{00062FFF-0000-0000-C000-000000000046}')
MajorVersion = 9
MinorVersion = 6
LibraryFlags = 8
LCID = 0x0

_Application_vtables_dispatch_ = 1
_Application_vtables_ = [
	(( 'Application' , 'Application' , ), 61440, (61440, (), [ (16393, 10, None, "IID('{00063001-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 56 , (3, 0, None, None) , 0 , )),
	(( 'Class' , 'Class' , ), 61450, (61450, (), [ (16387, 10, None, None) , ], 1 , 2 , 4 , 0 , 64 , (3, 0, None, None) , 0 , )),
	(( 'Session' , 'Session' , ), 61451, (61451, (), [ (16393, 10, None, "IID('{00063002-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 72 , (3, 0, None, None) , 0 , )),
	(( 'Parent' , 'Parent' , ), 61441, (61441, (), [ (16393, 10, None, None) , ], 1 , 2 , 4 , 0 , 80 , (3, 0, None, None) , 0 , )),
	(( 'Assistant' , 'Assistant' , ), 276, (276, (), [ (16393, 10, None, "IID('{000C0322-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 88 , (3, 0, None, None) , 64 , )),
	(( 'Name' , 'Name' , ), 12289, (12289, (), [ (16392, 10, None, None) , ], 1 , 2 , 4 , 0 , 96 , (3, 0, None, None) , 0 , )),
	(( 'Version' , 'Version' , ), 278, (278, (), [ (16392, 10, None, None) , ], 1 , 2 , 4 , 0 , 104 , (3, 0, None, None) , 0 , )),
	(( 'ActiveExplorer' , 'ActiveExplorer' , ), 273, (273, (), [ (16393, 10, None, "IID('{00063003-0000-0000-C000-000000000046}')") , ], 1 , 1 , 4 , 0 , 112 , (3, 0, None, None) , 0 , )),
	(( 'ActiveInspector' , 'ActiveInspector' , ), 274, (274, (), [ (16393, 10, None, "IID('{00063005-0000-0000-C000-000000000046}')") , ], 1 , 1 , 4 , 0 , 120 , (3, 0, None, None) , 0 , )),
	(( 'CreateItem' , 'ItemType' , 'Item' , ), 266, (266, (), [ (3, 1, None, None) , 
			 (16393, 10, None, None) , ], 1 , 1 , 4 , 0 , 128 , (3, 0, None, None) , 0 , )),
	(( 'CreateItemFromTemplate' , 'TemplatePath' , 'InFolder' , 'Item' , ), 267, (267, (), [ 
			 (8, 1, None, None) , (12, 17, None, None) , (16393, 10, None, None) , ], 1 , 1 , 4 , 1 , 136 , (3, 0, None, None) , 0 , )),
	(( 'CreateObject' , 'ObjectName' , 'Object' , ), 277, (277, (), [ (8, 1, None, None) , 
			 (16393, 10, None, None) , ], 1 , 1 , 4 , 0 , 144 , (3, 0, None, None) , 0 , )),
	(( 'GetNamespace' , 'Type' , 'NameSpace' , ), 272, (272, (), [ (8, 1, None, None) , 
			 (16393, 10, None, "IID('{00063002-0000-0000-C000-000000000046}')") , ], 1 , 1 , 4 , 0 , 152 , (3, 0, None, None) , 0 , )),
	(( 'Quit' , ), 275, (275, (), [ ], 1 , 1 , 4 , 0 , 160 , (3, 0, None, None) , 0 , )),
	(( 'COMAddIns' , 'COMAddIns' , ), 280, (280, (), [ (16393, 10, None, "IID('{000C0339-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 168 , (3, 0, None, None) , 0 , )),
	(( 'Explorers' , 'Explorers' , ), 281, (281, (), [ (16393, 10, None, "IID('{0006300A-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 176 , (3, 0, None, None) , 0 , )),
	(( 'Inspectors' , 'Inspectors' , ), 282, (282, (), [ (16393, 10, None, "IID('{00063008-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 184 , (3, 0, None, None) , 0 , )),
	(( 'LanguageSettings' , 'LanguageSettings' , ), 283, (283, (), [ (16393, 10, None, "IID('{000C0353-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 192 , (3, 0, None, None) , 0 , )),
	(( 'ProductCode' , 'ProductCode' , ), 284, (284, (), [ (16392, 10, None, None) , ], 1 , 2 , 4 , 0 , 200 , (3, 0, None, None) , 0 , )),
	(( 'AnswerWizard' , 'AnswerWizard' , ), 285, (285, (), [ (16393, 10, None, "IID('{000C0360-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 208 , (3, 0, None, None) , 64 , )),
	(( 'FeatureInstall' , 'FeatureInstall' , ), 286, (286, (), [ (16387, 10, None, None) , ], 1 , 2 , 4 , 0 , 216 , (3, 0, None, None) , 64 , )),
	(( 'FeatureInstall' , 'FeatureInstall' , ), 286, (286, (), [ (3, 1, None, None) , ], 1 , 4 , 4 , 0 , 224 , (3, 0, None, None) , 64 , )),
	(( 'ActiveWindow' , 'ActiveWindow' , ), 287, (287, (), [ (16393, 10, None, None) , ], 1 , 1 , 4 , 0 , 232 , (3, 0, None, None) , 0 , )),
	(( 'CopyFile' , 'FilePath' , 'DestFolderPath' , 'DocItem' , ), 64098, (64098, (), [ 
			 (8, 1, None, None) , (8, 1, None, None) , (16393, 10, None, None) , ], 1 , 1 , 4 , 0 , 240 , (3, 0, None, None) , 0 , )),
	(( 'AdvancedSearch' , 'Scope' , 'Filter' , 'SearchSubFolders' , 'Tag' , 
			 'AdvancedSearch' , ), 64101, (64101, (), [ (8, 1, None, None) , (12, 17, None, None) , (12, 17, None, None) , 
			 (12, 17, None, None) , (16393, 10, None, "IID('{0006300B-0000-0000-C000-000000000046}')") , ], 1 , 1 , 4 , 3 , 248 , (3, 0, None, None) , 0 , )),
	(( 'IsSearchSynchronous' , 'LookInFolders' , 'IsSearchSynchronous' , ), 64108, (64108, (), [ (8, 1, None, None) , 
			 (16395, 10, None, None) , ], 1 , 1 , 4 , 0 , 256 , (3, 0, None, None) , 0 , )),
	(( 'GetNewNickNames' , 'pvar' , ), 64072, (64072, (), [ (16396, 1, None, None) , ], 1 , 1 , 4 , 0 , 264 , (3, 0, None, None) , 64 , )),
	(( 'Reminders' , 'Reminders' , ), 64153, (64153, (), [ (16393, 10, None, "IID('{000630B1-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 272 , (3, 0, None, None) , 0 , )),
	(( 'DefaultProfileName' , 'DefaultProfileName' , ), 64214, (64214, (), [ (16392, 10, None, None) , ], 1 , 2 , 4 , 0 , 280 , (3, 0, None, None) , 0 , )),
	(( 'IsTrusted' , 'IsTrusted' , ), 64499, (64499, (), [ (16395, 10, None, None) , ], 1 , 2 , 4 , 0 , 288 , (3, 0, None, None) , 0 , )),
	(( 'GetObjectReference' , 'Item' , 'ReferenceType' , 'NewObject' , ), 64470, (64470, (), [ 
			 (9, 1, None, None) , (3, 1, None, None) , (16393, 10, None, None) , ], 1 , 1 , 4 , 0 , 296 , (3, 0, None, None) , 0 , )),
	(( 'Assistance' , 'Assistance' , ), 64520, (64520, (), [ (16393, 10, None, "IID('{4291224C-DEFE-485B-8E69-6CF8AA85CB76}')") , ], 1 , 2 , 4 , 0 , 304 , (3, 0, None, None) , 0 , )),
	(( 'TimeZones' , 'TimeZones' , ), 64553, (64553, (), [ (16397, 10, None, "IID('{000610FC-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 312 , (3, 0, None, None) , 0 , )),
	(( 'PickerDialog' , 'PickerDialog' , ), 64613, (64613, (), [ (16393, 10, None, "IID('{000C03E6-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 320 , (3, 0, None, None) , 0 , )),
	(( 'RefreshFormRegionDefinition' , 'RegionName' , ), 64639, (64639, (), [ (8, 1, None, None) , ], 1 , 1 , 4 , 0 , 328 , (3, 0, None, None) , 0 , )),
	(( 'MsoDebugOptions' , 'MsoDebugOptions' , ), 64673, (64673, (), [ (16393, 10, None, "IID('{000C035A-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 336 , (3, 0, None, None) , 64 , )),
	(( 'DataPrivacyOptions' , 'DataPrivacyOptions' , ), 64676, (64676, (), [ (16393, 10, None, "IID('{000C03D9-0000-0000-C000-000000000046}')") , ], 1 , 2 , 4 , 0 , 344 , (3, 0, None, None) , 64 , )),
]

win32com.client.CLSIDToClass.RegisterCLSID( "{00063001-0000-0000-C000-000000000046}", _Application )
