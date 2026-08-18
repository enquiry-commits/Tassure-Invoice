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

class ApplicationEvents:
	CLSID = CLSID_Sink = IID('{0006304E-0000-0000-C000-000000000046}')
	coclass_clsid = IID('{0006F03A-0000-0000-C000-000000000046}')
	_public_methods_ = [] # For COM Server support
	_dispid_to_func_ = {
		    61442 : "OnItemSend",
		    61443 : "OnNewMail",
		    61444 : "OnReminder",
		    61445 : "OnOptionsPagesAdd",
		    61446 : "OnStartup",
		    61447 : "OnQuit",
		}

	def __init__(self, oobj = None):
		if oobj is None:
			self._olecp = None
		else:
			import win32com.server.util
			from win32com.server.policy import EventHandlerPolicy
			cpc=oobj._oleobj_.QueryInterface(pythoncom.IID_IConnectionPointContainer)
			cp=cpc.FindConnectionPoint(self.CLSID_Sink)
			cookie=cp.Advise(win32com.server.util.wrap(self, usePolicy=EventHandlerPolicy))
			self._olecp,self._olecp_cookie = cp,cookie
	def __del__(self):
		try:
			self.close()
		except pythoncom.com_error:
			pass
	def close(self):
		if self._olecp is not None:
			cp,cookie,self._olecp,self._olecp_cookie = self._olecp,self._olecp_cookie,None,None
			cp.Unadvise(cookie)
	def _query_interface_(self, iid):
		import win32com.server.util
		if iid==self.CLSID_Sink: return win32com.server.util.wrap(self)

	# Event Handlers
	# If you create handlers, they should have the following prototypes:
#	def OnItemSend(self, Item=defaultNamedNotOptArg, Cancel=defaultNamedNotOptArg):
#	def OnNewMail(self):
#	def OnReminder(self, Item=defaultNamedNotOptArg):
#	def OnOptionsPagesAdd(self, Pages=defaultNamedNotOptArg):
#	def OnStartup(self):
#	def OnQuit(self):


win32com.client.CLSIDToClass.RegisterCLSID( "{0006304E-0000-0000-C000-000000000046}", ApplicationEvents )
