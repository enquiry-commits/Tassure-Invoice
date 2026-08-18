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

from win32com.client import CoClassBaseClass
import sys
__import__('win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents')
ApplicationEvents = sys.modules['win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents'].ApplicationEvents
__import__('win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents_10')
ApplicationEvents_10 = sys.modules['win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents_10'].ApplicationEvents_10
__import__('win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents_11')
ApplicationEvents_11 = sys.modules['win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6.ApplicationEvents_11'].ApplicationEvents_11
__import__('win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6._Application')
_Application = sys.modules['win32com.gen_py.00062FFF-0000-0000-C000-000000000046x0x9x6._Application']._Application
# This CoClass is known by the name 'Outlook.Application.16'
class Application(CoClassBaseClass): # A CoClass
	CLSID = IID('{0006F03A-0000-0000-C000-000000000046}')
	coclass_sources = [
		ApplicationEvents,
		ApplicationEvents_10,
		ApplicationEvents_11,
	]
	default_source = ApplicationEvents_11
	coclass_interfaces = [
		_Application,
	]
	default_interface = _Application

win32com.client.CLSIDToClass.RegisterCLSID( "{0006F03A-0000-0000-C000-000000000046}", Application )
