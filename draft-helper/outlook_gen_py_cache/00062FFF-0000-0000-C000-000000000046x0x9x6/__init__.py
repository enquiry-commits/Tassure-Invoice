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

class constants:
	olEas                         =4          # from enum OlAccountType
	olExchange                    =0          # from enum OlAccountType
	olHttp                        =3          # from enum OlAccountType
	olImap                        =1          # from enum OlAccountType
	olOtherAccount                =5          # from enum OlAccountType
	olPop3                        =2          # from enum OlAccountType
	olForward                     =2          # from enum OlActionCopyLike
	olReply                       =0          # from enum OlActionCopyLike
	olReplyAll                    =1          # from enum OlActionCopyLike
	olReplyFolder                 =3          # from enum OlActionCopyLike
	olRespond                     =4          # from enum OlActionCopyLike
	olEmbedOriginalItem           =1          # from enum OlActionReplyStyle
	olIncludeOriginalText         =2          # from enum OlActionReplyStyle
	olIndentOriginalText          =3          # from enum OlActionReplyStyle
	olLinkOriginalItem            =4          # from enum OlActionReplyStyle
	olOmitOriginalText            =0          # from enum OlActionReplyStyle
	olReplyTickOriginalText       =1000       # from enum OlActionReplyStyle
	olUserPreference              =5          # from enum OlActionReplyStyle
	olOpen                        =0          # from enum OlActionResponseStyle
	olPrompt                      =2          # from enum OlActionResponseStyle
	olSend                        =1          # from enum OlActionResponseStyle
	olDontShow                    =0          # from enum OlActionShowOn
	olMenu                        =1          # from enum OlActionShowOn
	olMenuAndToolbar              =2          # from enum OlActionShowOn
	olExchangeAgentAddressEntry   =3          # from enum OlAddressEntryUserType
	olExchangeDistributionListAddressEntry=1          # from enum OlAddressEntryUserType
	olExchangeOrganizationAddressEntry=4          # from enum OlAddressEntryUserType
	olExchangePublicFolderAddressEntry=2          # from enum OlAddressEntryUserType
	olExchangeRemoteUserAddressEntry=5          # from enum OlAddressEntryUserType
	olExchangeUserAddressEntry    =0          # from enum OlAddressEntryUserType
	olLdapAddressEntry            =20         # from enum OlAddressEntryUserType
	olOtherAddressEntry           =40         # from enum OlAddressEntryUserType
	olOutlookContactAddressEntry  =10         # from enum OlAddressEntryUserType
	olOutlookDistributionListAddressEntry=11         # from enum OlAddressEntryUserType
	olSmtpAddressEntry            =30         # from enum OlAddressEntryUserType
	olCustomAddressList           =4          # from enum OlAddressListType
	olExchangeContainer           =1          # from enum OlAddressListType
	olExchangeGlobalAddressList   =0          # from enum OlAddressListType
	olOutlookAddressList          =2          # from enum OlAddressListType
	olOutlookLdapAddressList      =3          # from enum OlAddressListType
	olAlignCenter                 =1          # from enum OlAlign
	olAlignLeft                   =0          # from enum OlAlign
	olAlignRight                  =2          # from enum OlAlign
	olAlignmentLeft               =0          # from enum OlAlignment
	olAlignmentRight              =1          # from enum OlAlignment
	olAlwaysDelete                =1          # from enum OlAlwaysDeleteConversation
	olAlwaysDeleteUnsupported     =2          # from enum OlAlwaysDeleteConversation
	olDoNotDelete                 =0          # from enum OlAlwaysDeleteConversation
	olCopyAsAccept                =2          # from enum OlAppointmentCopyOptions
	olCreateAppointment           =1          # from enum OlAppointmentCopyOptions
	olPromptUser                  =0          # from enum OlAppointmentCopyOptions
	olAppointmentTimeFieldEnd     =3          # from enum OlAppointmentTimeField
	olAppointmentTimeFieldNone    =1          # from enum OlAppointmentTimeField
	olAppointmentTimeFieldStart   =2          # from enum OlAppointmentTimeField
	olAttachmentBlockLevelNone    =0          # from enum OlAttachmentBlockLevel
	olAttachmentBlockLevelOpen    =1          # from enum OlAttachmentBlockLevel
	olByReference                 =4          # from enum OlAttachmentType
	olByValue                     =1          # from enum OlAttachmentType
	olEmbeddeditem                =5          # from enum OlAttachmentType
	olOLE                         =6          # from enum OlAttachmentType
	olAutoDiscoverConnectionExternal=1          # from enum OlAutoDiscoverConnectionMode
	olAutoDiscoverConnectionInternal=2          # from enum OlAutoDiscoverConnectionMode
	olAutoDiscoverConnectionInternalDomain=3          # from enum OlAutoDiscoverConnectionMode
	olAutoDiscoverConnectionUnknown=0          # from enum OlAutoDiscoverConnectionMode
	olAutoPreviewAll              =0          # from enum OlAutoPreview
	olAutoPreviewNone             =2          # from enum OlAutoPreview
	olAutoPreviewUnread           =1          # from enum OlAutoPreview
	olBackStyleOpaque             =1          # from enum OlBackStyle
	olBackStyleTransparent        =0          # from enum OlBackStyle
	olFormatHTML                  =2          # from enum OlBodyFormat
	olFormatPlain                 =1          # from enum OlBodyFormat
	olFormatRichText              =3          # from enum OlBodyFormat
	olFormatUnspecified           =0          # from enum OlBodyFormat
	olBorderStyleNone             =0          # from enum OlBorderStyle
	olBorderStyleSingle           =1          # from enum OlBorderStyle
	olBusinessCardTypeInterConnect=1          # from enum OlBusinessCardType
	olBusinessCardTypeOutlook     =0          # from enum OlBusinessCardType
	olBusy                        =2          # from enum OlBusyStatus
	olFree                        =0          # from enum OlBusyStatus
	olOutOfOffice                 =3          # from enum OlBusyStatus
	olTentative                   =1          # from enum OlBusyStatus
	olWorkingElsewhere            =4          # from enum OlBusyStatus
	olFreeBusyAndSubject          =1          # from enum OlCalendarDetail
	olFreeBusyOnly                =0          # from enum OlCalendarDetail
	olFullDetails                 =2          # from enum OlCalendarDetail
	olCalendarMailFormatDailySchedule=0          # from enum OlCalendarMailFormat
	olCalendarMailFormatEventList =1          # from enum OlCalendarMailFormat
	olCalendarView5DayWeek        =4          # from enum OlCalendarViewMode
	olCalendarViewDay             =0          # from enum OlCalendarViewMode
	olCalendarViewMonth           =2          # from enum OlCalendarViewMode
	olCalendarViewMultiDay        =3          # from enum OlCalendarViewMode
	olCalendarViewWeek            =1          # from enum OlCalendarViewMode
	olCategoryColorBlack          =15         # from enum OlCategoryColor
	olCategoryColorBlue           =8          # from enum OlCategoryColor
	olCategoryColorDarkBlue       =23         # from enum OlCategoryColor
	olCategoryColorDarkGray       =14         # from enum OlCategoryColor
	olCategoryColorDarkGreen      =20         # from enum OlCategoryColor
	olCategoryColorDarkMaroon     =25         # from enum OlCategoryColor
	olCategoryColorDarkOlive      =22         # from enum OlCategoryColor
	olCategoryColorDarkOrange     =17         # from enum OlCategoryColor
	olCategoryColorDarkPeach      =18         # from enum OlCategoryColor
	olCategoryColorDarkPurple     =24         # from enum OlCategoryColor
	olCategoryColorDarkRed        =16         # from enum OlCategoryColor
	olCategoryColorDarkSteel      =12         # from enum OlCategoryColor
	olCategoryColorDarkTeal       =21         # from enum OlCategoryColor
	olCategoryColorDarkYellow     =19         # from enum OlCategoryColor
	olCategoryColorGray           =13         # from enum OlCategoryColor
	olCategoryColorGreen          =5          # from enum OlCategoryColor
	olCategoryColorMaroon         =10         # from enum OlCategoryColor
	olCategoryColorNone           =0          # from enum OlCategoryColor
	olCategoryColorOlive          =7          # from enum OlCategoryColor
	olCategoryColorOrange         =2          # from enum OlCategoryColor
	olCategoryColorPeach          =3          # from enum OlCategoryColor
	olCategoryColorPurple         =9          # from enum OlCategoryColor
	olCategoryColorRed            =1          # from enum OlCategoryColor
	olCategoryColorSteel          =11         # from enum OlCategoryColor
	olCategoryColorTeal           =6          # from enum OlCategoryColor
	olCategoryColorYellow         =4          # from enum OlCategoryColor
	olCategoryShortcutKeyCtrlF10  =9          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF11  =10         # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF12  =11         # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF2   =1          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF3   =2          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF4   =3          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF5   =4          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF6   =5          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF7   =6          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF8   =7          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyCtrlF9   =8          # from enum OlCategoryShortcutKey
	olCategoryShortcutKeyNone     =0          # from enum OlCategoryShortcutKey
	olAutoColor                   =0          # from enum OlColor
	olColorAqua                   =15         # from enum OlColor
	olColorBlack                  =1          # from enum OlColor
	olColorBlue                   =13         # from enum OlColor
	olColorFuchsia                =14         # from enum OlColor
	olColorGray                   =8          # from enum OlColor
	olColorGreen                  =3          # from enum OlColor
	olColorLime                   =11         # from enum OlColor
	olColorMaroon                 =2          # from enum OlColor
	olColorNavy                   =5          # from enum OlColor
	olColorOlive                  =4          # from enum OlColor
	olColorPurple                 =6          # from enum OlColor
	olColorRed                    =10         # from enum OlColor
	olColorSilver                 =9          # from enum OlColor
	olColorTeal                   =7          # from enum OlColor
	olColorWhite                  =16         # from enum OlColor
	olColorYellow                 =12         # from enum OlColor
	olComboBoxStyleCombo          =0          # from enum OlComboBoxStyle
	olComboBoxStyleList           =2          # from enum OlComboBoxStyle
	olContactPhoneAssistant       =0          # from enum OlContactPhoneNumber
	olContactPhoneBusiness        =1          # from enum OlContactPhoneNumber
	olContactPhoneBusiness2       =2          # from enum OlContactPhoneNumber
	olContactPhoneBusinessFax     =3          # from enum OlContactPhoneNumber
	olContactPhoneCallback        =4          # from enum OlContactPhoneNumber
	olContactPhoneCar             =5          # from enum OlContactPhoneNumber
	olContactPhoneCompany         =6          # from enum OlContactPhoneNumber
	olContactPhoneHome            =7          # from enum OlContactPhoneNumber
	olContactPhoneHome2           =8          # from enum OlContactPhoneNumber
	olContactPhoneHomeFax         =9          # from enum OlContactPhoneNumber
	olContactPhoneISDN            =10         # from enum OlContactPhoneNumber
	olContactPhoneMobile          =11         # from enum OlContactPhoneNumber
	olContactPhoneOther           =12         # from enum OlContactPhoneNumber
	olContactPhoneOtherFax        =13         # from enum OlContactPhoneNumber
	olContactPhonePager           =14         # from enum OlContactPhoneNumber
	olContactPhonePrimary         =15         # from enum OlContactPhoneNumber
	olContactPhoneRadio           =16         # from enum OlContactPhoneNumber
	olContactPhoneTTYTTD          =18         # from enum OlContactPhoneNumber
	olContactPhoneTelex           =17         # from enum OlContactPhoneNumber
	olAttachmentContextMenu       =3          # from enum OlContextMenu
	olFolderContextMenu           =2          # from enum OlContextMenu
	olItemContextMenu             =0          # from enum OlContextMenu
	olShortcutContextMenu         =5          # from enum OlContextMenu
	olStoreContextMenu            =4          # from enum OlContextMenu
	olViewContextMenu             =1          # from enum OlContextMenu
	olTimeScale10Minutes          =2          # from enum OlDayWeekTimeScale
	olTimeScale15Minutes          =3          # from enum OlDayWeekTimeScale
	olTimeScale30Minutes          =4          # from enum OlDayWeekTimeScale
	olTimeScale5Minutes           =0          # from enum OlDayWeekTimeScale
	olTimeScale60Minutes          =5          # from enum OlDayWeekTimeScale
	olTimeScale6Minutes           =1          # from enum OlDayWeekTimeScale
	olFriday                      =32         # from enum OlDaysOfWeek
	olMonday                      =2          # from enum OlDaysOfWeek
	olSaturday                    =64         # from enum OlDaysOfWeek
	olSunday                      =1          # from enum OlDaysOfWeek
	olThursday                    =16         # from enum OlDaysOfWeek
	olTuesday                     =4          # from enum OlDaysOfWeek
	olWednesday                   =8          # from enum OlDaysOfWeek
	olAllCollapsed                =1          # from enum OlDefaultExpandCollapseSetting
	olAllExpanded                 =0          # from enum OlDefaultExpandCollapseSetting
	olLastViewed                  =2          # from enum OlDefaultExpandCollapseSetting
	olFolderCalendar              =9          # from enum OlDefaultFolders
	olFolderConflicts             =19         # from enum OlDefaultFolders
	olFolderContacts              =10         # from enum OlDefaultFolders
	olFolderDeletedItems          =3          # from enum OlDefaultFolders
	olFolderDrafts                =16         # from enum OlDefaultFolders
	olFolderInbox                 =6          # from enum OlDefaultFolders
	olFolderJournal               =11         # from enum OlDefaultFolders
	olFolderJunk                  =23         # from enum OlDefaultFolders
	olFolderLocalFailures         =21         # from enum OlDefaultFolders
	olFolderManagedEmail          =29         # from enum OlDefaultFolders
	olFolderNotes                 =12         # from enum OlDefaultFolders
	olFolderOutbox                =4          # from enum OlDefaultFolders
	olFolderRssFeeds              =25         # from enum OlDefaultFolders
	olFolderSentMail              =5          # from enum OlDefaultFolders
	olFolderServerFailures        =22         # from enum OlDefaultFolders
	olFolderSuggestedContacts     =30         # from enum OlDefaultFolders
	olFolderSyncIssues            =20         # from enum OlDefaultFolders
	olFolderTasks                 =13         # from enum OlDefaultFolders
	olFolderToDo                  =28         # from enum OlDefaultFolders
	olPublicFoldersAllPublicFolders=18         # from enum OlDefaultFolders
	olDefaultDelegates            =6          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultMail                 =1          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultMeeting              =2          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultMembers              =5          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultPickRooms            =8          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultSharingRequest       =4          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultSingleName           =7          # from enum OlDefaultSelectNamesDisplayMode
	olDefaultTask                 =3          # from enum OlDefaultSelectNamesDisplayMode
	olDisplayModeNormal           =0          # from enum OlDisplayMode
	olDisplayModePortraitReadingPane=2          # from enum OlDisplayMode
	olDisplayModePortraitView     =1          # from enum OlDisplayMode
	olAgent                       =3          # from enum OlDisplayType
	olDistList                    =1          # from enum OlDisplayType
	olForum                       =2          # from enum OlDisplayType
	olOrganization                =4          # from enum OlDisplayType
	olPrivateDistList             =5          # from enum OlDisplayType
	olRemoteUser                  =6          # from enum OlDisplayType
	olUser                        =0          # from enum OlDisplayType
	olFullItem                    =1          # from enum OlDownloadState
	olHeaderOnly                  =0          # from enum OlDownloadState
	olDragBehaviorDisabled        =0          # from enum OlDragBehavior
	olDragBehaviorEnabled         =1          # from enum OlDragBehavior
	olEditorHTML                  =2          # from enum OlEditorType
	olEditorRTF                   =3          # from enum OlEditorType
	olEditorText                  =1          # from enum OlEditorType
	olEditorWord                  =4          # from enum OlEditorType
	olEnterFieldBehaviorRecallSelection=1          # from enum OlEnterFieldBehavior
	olEnterFieldBehaviorSelectAll =0          # from enum OlEnterFieldBehavior
	olCachedConnectedDrizzle      =600        # from enum OlExchangeConnectionMode
	olCachedConnectedFull         =700        # from enum OlExchangeConnectionMode
	olCachedConnectedHeaders      =500        # from enum OlExchangeConnectionMode
	olCachedDisconnected          =400        # from enum OlExchangeConnectionMode
	olCachedOffline               =200        # from enum OlExchangeConnectionMode
	olDisconnected                =300        # from enum OlExchangeConnectionMode
	olNoExchange                  =0          # from enum OlExchangeConnectionMode
	olOffline                     =100        # from enum OlExchangeConnectionMode
	olOnline                      =800        # from enum OlExchangeConnectionMode
	olAdditionalExchangeMailbox   =4          # from enum OlExchangeStoreType
	olExchangeMailbox             =1          # from enum OlExchangeStoreType
	olExchangePublicFolder        =2          # from enum OlExchangeStoreType
	olNotExchange                 =3          # from enum OlExchangeStoreType
	olPrimaryExchangeMailbox      =0          # from enum OlExchangeStoreType
	olBlueFlagIcon                =5          # from enum OlFlagIcon
	olGreenFlagIcon               =3          # from enum OlFlagIcon
	olNoFlagIcon                  =0          # from enum OlFlagIcon
	olOrangeFlagIcon              =2          # from enum OlFlagIcon
	olPurpleFlagIcon              =1          # from enum OlFlagIcon
	olRedFlagIcon                 =6          # from enum OlFlagIcon
	olYellowFlagIcon              =4          # from enum OlFlagIcon
	olFlagComplete                =1          # from enum OlFlagStatus
	olFlagMarked                  =2          # from enum OlFlagStatus
	olNoFlag                      =0          # from enum OlFlagStatus
	olFolderDisplayFolderOnly     =1          # from enum OlFolderDisplayMode
	olFolderDisplayNoNavigation   =2          # from enum OlFolderDisplayMode
	olFolderDisplayNormal         =0          # from enum OlFolderDisplayMode
	olFormRegionIconDefault       =1          # from enum OlFormRegionIcon
	olFormRegionIconEncrypted     =9          # from enum OlFormRegionIcon
	olFormRegionIconForwarded     =5          # from enum OlFormRegionIcon
	olFormRegionIconPage          =11         # from enum OlFormRegionIcon
	olFormRegionIconRead          =3          # from enum OlFormRegionIcon
	olFormRegionIconRecurring     =12         # from enum OlFormRegionIcon
	olFormRegionIconReplied       =4          # from enum OlFormRegionIcon
	olFormRegionIconSigned        =8          # from enum OlFormRegionIcon
	olFormRegionIconSubmitted     =7          # from enum OlFormRegionIcon
	olFormRegionIconUnread        =2          # from enum OlFormRegionIcon
	olFormRegionIconUnsent        =6          # from enum OlFormRegionIcon
	olFormRegionIconWindow        =10         # from enum OlFormRegionIcon
	olFormRegionCompose           =1          # from enum OlFormRegionMode
	olFormRegionPreview           =2          # from enum OlFormRegionMode
	olFormRegionRead              =0          # from enum OlFormRegionMode
	olFormRegionTypeAdjoining     =1          # from enum OlFormRegionSize
	olFormRegionTypeSeparate      =0          # from enum OlFormRegionSize
	olDefaultRegistry             =0          # from enum OlFormRegistry
	olFolderRegistry              =3          # from enum OlFormRegistry
	olOrganizationRegistry        =4          # from enum OlFormRegistry
	olPersonalRegistry            =2          # from enum OlFormRegistry
	olFormatCurrencyDecimal       =1          # from enum OlFormatCurrency
	olFormatCurrencyNonDecimal    =2          # from enum OlFormatCurrency
	OlFormatDateTimeLongDayDate   =5          # from enum OlFormatDateTime
	olFormatDateTimeBestFit       =17         # from enum OlFormatDateTime
	olFormatDateTimeLongDate      =6          # from enum OlFormatDateTime
	olFormatDateTimeLongDateReversed=7          # from enum OlFormatDateTime
	olFormatDateTimeLongDayDateTime=1          # from enum OlFormatDateTime
	olFormatDateTimeLongTime      =15         # from enum OlFormatDateTime
	olFormatDateTimeShortDate     =8          # from enum OlFormatDateTime
	olFormatDateTimeShortDateNumOnly=9          # from enum OlFormatDateTime
	olFormatDateTimeShortDateTime =2          # from enum OlFormatDateTime
	olFormatDateTimeShortDayDate  =13         # from enum OlFormatDateTime
	olFormatDateTimeShortDayDateTime=3          # from enum OlFormatDateTime
	olFormatDateTimeShortDayMonth =10         # from enum OlFormatDateTime
	olFormatDateTimeShortDayMonthDateTime=4          # from enum OlFormatDateTime
	olFormatDateTimeShortMonthYear=11         # from enum OlFormatDateTime
	olFormatDateTimeShortMonthYearNumOnly=12         # from enum OlFormatDateTime
	olFormatDateTimeShortTime     =16         # from enum OlFormatDateTime
	olFormatDurationLong          =2          # from enum OlFormatDuration
	olFormatDurationLongBusiness  =4          # from enum OlFormatDuration
	olFormatDurationShort         =1          # from enum OlFormatDuration
	olFormatDurationShortBusiness =3          # from enum OlFormatDuration
	olFormatEnumBitmap            =1          # from enum OlFormatEnumeration
	olFormatEnumText              =2          # from enum OlFormatEnumeration
	olFormatIntegerComputer1      =2          # from enum OlFormatInteger
	olFormatIntegerComputer2      =3          # from enum OlFormatInteger
	olFormatIntegerComputer3      =4          # from enum OlFormatInteger
	olFormatIntegerPlain          =1          # from enum OlFormatInteger
	olFormatKeywordsText          =1          # from enum OlFormatKeywords
	olFormatNumber1Decimal        =3          # from enum OlFormatNumber
	olFormatNumber2Decimal        =4          # from enum OlFormatNumber
	olFormatNumberAllDigits       =1          # from enum OlFormatNumber
	olFormatNumberComputer1       =6          # from enum OlFormatNumber
	olFormatNumberComputer2       =7          # from enum OlFormatNumber
	olFormatNumberComputer3       =8          # from enum OlFormatNumber
	olFormatNumberRaw             =9          # from enum OlFormatNumber
	olFormatNumberScientific      =5          # from enum OlFormatNumber
	olFormatNumberTruncated       =2          # from enum OlFormatNumber
	olFormatPercent1Decimal       =2          # from enum OlFormatPercent
	olFormatPercent2Decimal       =3          # from enum OlFormatPercent
	olFormatPercentAllDigits      =4          # from enum OlFormatPercent
	olFormatPercentRounded        =1          # from enum OlFormatPercent
	olFormatSmartFromFromOnly     =2          # from enum OlFormatSmartFrom
	olFormatSmartFromFromTo       =1          # from enum OlFormatSmartFrom
	olFormatTextText              =1          # from enum OlFormatText
	olFormatYesNoIcon             =4          # from enum OlFormatYesNo
	olFormatYesNoOnOff            =2          # from enum OlFormatYesNo
	olFormatYesNoTrueFalse        =3          # from enum OlFormatYesNo
	olFormatYesNoYesNo            =1          # from enum OlFormatYesNo
	olFemale                      =1          # from enum OlGender
	olMale                        =2          # from enum OlGender
	olUnspecified                 =0          # from enum OlGender
	olGridLineDashes              =3          # from enum OlGridLineStyle
	olGridLineLargeDots           =2          # from enum OlGridLineStyle
	olGridLineNone                =0          # from enum OlGridLineStyle
	olGridLineSmallDots           =1          # from enum OlGridLineStyle
	olGridLineSolid               =4          # from enum OlGridLineStyle
	olCustomFoldersGroup          =0          # from enum OlGroupType
	olFavoriteFoldersGroup        =4          # from enum OlGroupType
	olMyFoldersGroup              =1          # from enum OlGroupType
	olOtherFoldersGroup           =3          # from enum OlGroupType
	olPeopleFoldersGroup          =2          # from enum OlGroupType
	olReadOnlyGroup               =6          # from enum OlGroupType
	olRoomsGroup                  =5          # from enum OlGroupType
	olHorizontalLayoutAlignCenter =1          # from enum OlHorizontalLayout
	olHorizontalLayoutAlignLeft   =0          # from enum OlHorizontalLayout
	olHorizontalLayoutAlignRight  =2          # from enum OlHorizontalLayout
	olHorizontalLayoutGrow        =3          # from enum OlHorizontalLayout
	olIconAutoArrange             =2          # from enum OlIconViewPlacement
	olIconDoNotArrange            =0          # from enum OlIconViewPlacement
	olIconLineUp                  =1          # from enum OlIconViewPlacement
	olIconSortAndAutoArrange      =3          # from enum OlIconViewPlacement
	olIconViewLarge               =0          # from enum OlIconViewType
	olIconViewList                =2          # from enum OlIconViewType
	olIconViewSmall               =1          # from enum OlIconViewType
	olImportanceHigh              =2          # from enum OlImportance
	olImportanceLow               =0          # from enum OlImportance
	olImportanceNormal            =1          # from enum OlImportance
	olDiscard                     =1          # from enum OlInspectorClose
	olPromptForSave               =2          # from enum OlInspectorClose
	olSave                        =0          # from enum OlInspectorClose
	olAppointmentItem             =1          # from enum OlItemType
	olContactItem                 =2          # from enum OlItemType
	olDistributionListItem        =7          # from enum OlItemType
	olJournalItem                 =4          # from enum OlItemType
	olMailItem                    =0          # from enum OlItemType
	olMobileItemMMS               =12         # from enum OlItemType
	olMobileItemSMS               =11         # from enum OlItemType
	olNoteItem                    =5          # from enum OlItemType
	olPostItem                    =6          # from enum OlItemType
	olTaskItem                    =3          # from enum OlItemType
	olAssociatedContact           =1          # from enum OlJournalRecipientType
	olBCC                         =3          # from enum OlMailRecipientType
	olCC                          =2          # from enum OlMailRecipientType
	olOriginator                  =0          # from enum OlMailRecipientType
	olTo                          =1          # from enum OlMailRecipientType
	olBusiness                    =2          # from enum OlMailingAddress
	olHome                        =1          # from enum OlMailingAddress
	olNone                        =0          # from enum OlMailingAddress
	olOther                       =3          # from enum OlMailingAddress
	olMarkComplete                =5          # from enum OlMarkInterval
	olMarkNextWeek                =3          # from enum OlMarkInterval
	olMarkNoDate                  =4          # from enum OlMarkInterval
	olMarkThisWeek                =2          # from enum OlMarkInterval
	olMarkToday                   =0          # from enum OlMarkInterval
	olMarkTomorrow                =1          # from enum OlMarkInterval
	olMatchEntryComplete          =1          # from enum OlMatchEntry
	olMatchEntryFirstLetter       =0          # from enum OlMatchEntry
	olMatchEntryNone              =2          # from enum OlMatchEntry
	olAlibabaDingTalk             =15         # from enum OlMeetingProvider
	olAmazonChimePrivate          =14         # from enum OlMeetingProvider
	olAmazonChimePublic           =13         # from enum OlMeetingProvider
	olAppleFacetime               =17         # from enum OlMeetingProvider
	olBlueJeans                   =7          # from enum OlMeetingProvider
	olClaroVideoconferencia       =18         # from enum OlMeetingProvider
	olFacebookWorkplace           =16         # from enum OlMeetingProvider
	olGoToMeeting                 =8          # from enum OlMeetingProvider
	olGoogleMeet                  =10         # from enum OlMeetingProvider
	olJioMeet                     =11         # from enum OlMeetingProvider
	olNoProvider                  =0          # from enum OlMeetingProvider
	olNotSupported                =2          # from enum OlMeetingProvider
	olProviderNotReady            =200        # from enum OlMeetingProvider
	olRingCentral                 =12         # from enum OlMeetingProvider
	olSkypeBusiness               =3          # from enum OlMeetingProvider
	olSkypeConsumer               =4          # from enum OlMeetingProvider
	olTeams                       =5          # from enum OlMeetingProvider
	olUnknownProvider             =1          # from enum OlMeetingProvider
	olWebex                       =9          # from enum OlMeetingProvider
	olZoom                        =6          # from enum OlMeetingProvider
	olOptional                    =2          # from enum OlMeetingRecipientType
	olOrganizer                   =0          # from enum OlMeetingRecipientType
	olRequired                    =1          # from enum OlMeetingRecipientType
	olResource                    =3          # from enum OlMeetingRecipientType
	olMeetingAccepted             =3          # from enum OlMeetingResponse
	olMeetingDeclined             =4          # from enum OlMeetingResponse
	olMeetingTentative            =2          # from enum OlMeetingResponse
	olMeeting                     =1          # from enum OlMeetingStatus
	olMeetingCanceled             =5          # from enum OlMeetingStatus
	olMeetingReceived             =3          # from enum OlMeetingStatus
	olMeetingReceivedAndCanceled  =7          # from enum OlMeetingStatus
	olNonMeeting                  =0          # from enum OlMeetingStatus
	olMMS                         =1          # from enum OlMobileFormat
	olSMS                         =0          # from enum OlMobileFormat
	olMouseButtonLeft             =1          # from enum OlMouseButton
	olMouseButtonMiddle           =4          # from enum OlMouseButton
	olMouseButtonRight            =2          # from enum OlMouseButton
	olMousePointerAppStarting     =13         # from enum OlMousePointer
	olMousePointerArrow           =1          # from enum OlMousePointer
	olMousePointerCross           =2          # from enum OlMousePointer
	olMousePointerCustom          =99         # from enum OlMousePointer
	olMousePointerDefault         =0          # from enum OlMousePointer
	olMousePointerHelp            =14         # from enum OlMousePointer
	olMousePointerHourGlass       =11         # from enum OlMousePointer
	olMousePointerIBeam           =3          # from enum OlMousePointer
	olMousePointerNoDrop          =12         # from enum OlMousePointer
	olMousePointerSizeAll         =15         # from enum OlMousePointer
	olMousePointerSizeNESW        =6          # from enum OlMousePointer
	olMousePointerSizeNS          =7          # from enum OlMousePointer
	olMousePointerSizeNWSE        =8          # from enum OlMousePointer
	olMousePointerSizeWE          =9          # from enum OlMousePointer
	olMousePointerUpArrow         =10         # from enum OlMousePointer
	olAlwaysMultiLine             =2          # from enum OlMultiLine
	olAlwaysSingleLine            =1          # from enum OlMultiLine
	olWidthMultiLine              =0          # from enum OlMultiLine
	olMultiSelectExtended         =2          # from enum OlMultiSelect
	olMultiSelectMulti            =1          # from enum OlMultiSelect
	olMultiSelectSingle           =0          # from enum OlMultiSelect
	olModuleCalendar              =1          # from enum OlNavigationModuleType
	olModuleContacts              =2          # from enum OlNavigationModuleType
	olModuleFolderList            =6          # from enum OlNavigationModuleType
	olModuleJournal               =4          # from enum OlNavigationModuleType
	olModuleMail                  =0          # from enum OlNavigationModuleType
	olModuleNotes                 =5          # from enum OlNavigationModuleType
	olModuleShortcuts             =7          # from enum OlNavigationModuleType
	olModuleSolutions             =8          # from enum OlNavigationModuleType
	olModuleTasks                 =3          # from enum OlNavigationModuleType
	olExchangeConferencing        =2          # from enum OlNetMeetingType
	olNetMeeting                  =0          # from enum OlNetMeetingType
	olNetShow                     =1          # from enum OlNetMeetingType
	olBlue                        =0          # from enum OlNoteColor
	olGreen                       =1          # from enum OlNoteColor
	olPink                        =2          # from enum OlNoteColor
	olWhite                       =4          # from enum OlNoteColor
	olYellow                      =3          # from enum OlNoteColor
	olAccount                     =105        # from enum OlObjectClass
	olAccountRuleCondition        =135        # from enum OlObjectClass
	olAccounts                    =106        # from enum OlObjectClass
	olAction                      =32         # from enum OlObjectClass
	olActions                     =33         # from enum OlObjectClass
	olAddressEntries              =21         # from enum OlObjectClass
	olAddressEntry                =8          # from enum OlObjectClass
	olAddressList                 =7          # from enum OlObjectClass
	olAddressLists                =20         # from enum OlObjectClass
	olAddressRuleCondition        =170        # from enum OlObjectClass
	olApplication                 =0          # from enum OlObjectClass
	olAppointment                 =26         # from enum OlObjectClass
	olAssignToCategoryRuleAction  =122        # from enum OlObjectClass
	olAttachment                  =5          # from enum OlObjectClass
	olAttachmentSelection         =169        # from enum OlObjectClass
	olAttachments                 =18         # from enum OlObjectClass
	olAutoFormatRule              =147        # from enum OlObjectClass
	olAutoFormatRules             =148        # from enum OlObjectClass
	olCalendarModule              =159        # from enum OlObjectClass
	olCalendarSharing             =151        # from enum OlObjectClass
	olCategories                  =153        # from enum OlObjectClass
	olCategory                    =152        # from enum OlObjectClass
	olCategoryRuleCondition       =130        # from enum OlObjectClass
	olClassBusinessCardView       =168        # from enum OlObjectClass
	olClassCalendarView           =139        # from enum OlObjectClass
	olClassCardView               =138        # from enum OlObjectClass
	olClassIconView               =137        # from enum OlObjectClass
	olClassMessageListView        =187        # from enum OlObjectClass
	olClassNavigationPane         =155        # from enum OlObjectClass
	olClassPeopleView             =183        # from enum OlObjectClass
	olClassSearchView             =188        # from enum OlObjectClass
	olClassTableView              =136        # from enum OlObjectClass
	olClassThreadView             =184        # from enum OlObjectClass
	olClassTimeLineView           =140        # from enum OlObjectClass
	olClassTimeZone               =174        # from enum OlObjectClass
	olClassTimeZones              =175        # from enum OlObjectClass
	olColumn                      =154        # from enum OlObjectClass
	olColumnFormat                =149        # from enum OlObjectClass
	olColumns                     =150        # from enum OlObjectClass
	olConflict                    =102        # from enum OlObjectClass
	olConflicts                   =103        # from enum OlObjectClass
	olContact                     =40         # from enum OlObjectClass
	olContactsModule              =160        # from enum OlObjectClass
	olConversation                =178        # from enum OlObjectClass
	olConversationHeader          =182        # from enum OlObjectClass
	olDistributionList            =69         # from enum OlObjectClass
	olDocument                    =41         # from enum OlObjectClass
	olException                   =30         # from enum OlObjectClass
	olExceptions                  =29         # from enum OlObjectClass
	olExchangeDistributionList    =111        # from enum OlObjectClass
	olExchangeUser                =110        # from enum OlObjectClass
	olExplorer                    =34         # from enum OlObjectClass
	olExplorers                   =60         # from enum OlObjectClass
	olFolder                      =2          # from enum OlObjectClass
	olFolders                     =15         # from enum OlObjectClass
	olFormDescription             =37         # from enum OlObjectClass
	olFormNameRuleCondition       =131        # from enum OlObjectClass
	olFormRegion                  =129        # from enum OlObjectClass
	olFromRssFeedRuleCondition    =173        # from enum OlObjectClass
	olFromRuleCondition           =132        # from enum OlObjectClass
	olImportanceRuleCondition     =128        # from enum OlObjectClass
	olInspector                   =35         # from enum OlObjectClass
	olInspectors                  =61         # from enum OlObjectClass
	olItemProperties              =98         # from enum OlObjectClass
	olItemProperty                =99         # from enum OlObjectClass
	olItems                       =16         # from enum OlObjectClass
	olJournal                     =42         # from enum OlObjectClass
	olJournalModule               =162        # from enum OlObjectClass
	olLink                        =75         # from enum OlObjectClass
	olLinks                       =76         # from enum OlObjectClass
	olMail                        =43         # from enum OlObjectClass
	olMailModule                  =158        # from enum OlObjectClass
	olMarkAsTaskRuleAction        =124        # from enum OlObjectClass
	olMeetingCancellation         =54         # from enum OlObjectClass
	olMeetingForwardNotification  =181        # from enum OlObjectClass
	olMeetingRequest              =53         # from enum OlObjectClass
	olMeetingResponseNegative     =55         # from enum OlObjectClass
	olMeetingResponsePositive     =56         # from enum OlObjectClass
	olMeetingResponseTentative    =57         # from enum OlObjectClass
	olMobile                      =176        # from enum OlObjectClass
	olMoveOrCopyRuleAction        =118        # from enum OlObjectClass
	olNamespace                   =1          # from enum OlObjectClass
	olNavigationFolder            =167        # from enum OlObjectClass
	olNavigationFolders           =166        # from enum OlObjectClass
	olNavigationGroup             =165        # from enum OlObjectClass
	olNavigationGroups            =164        # from enum OlObjectClass
	olNavigationModule            =157        # from enum OlObjectClass
	olNavigationModules           =156        # from enum OlObjectClass
	olNewItemAlertRuleAction      =125        # from enum OlObjectClass
	olNote                        =44         # from enum OlObjectClass
	olNotesModule                 =163        # from enum OlObjectClass
	olOrderField                  =144        # from enum OlObjectClass
	olOrderFields                 =145        # from enum OlObjectClass
	olOutlookBarGroup             =66         # from enum OlObjectClass
	olOutlookBarGroups            =65         # from enum OlObjectClass
	olOutlookBarPane              =63         # from enum OlObjectClass
	olOutlookBarShortcut          =68         # from enum OlObjectClass
	olOutlookBarShortcuts         =67         # from enum OlObjectClass
	olOutlookBarStorage           =64         # from enum OlObjectClass
	olOutspace                    =180        # from enum OlObjectClass
	olPages                       =36         # from enum OlObjectClass
	olPanes                       =62         # from enum OlObjectClass
	olPlaySoundRuleAction         =123        # from enum OlObjectClass
	olPost                        =45         # from enum OlObjectClass
	olPreviewPane                 =185        # from enum OlObjectClass
	olPropertyAccessor            =112        # from enum OlObjectClass
	olPropertyPageSite            =70         # from enum OlObjectClass
	olPropertyPages               =71         # from enum OlObjectClass
	olRecipient                   =4          # from enum OlObjectClass
	olRecipients                  =17         # from enum OlObjectClass
	olRecurrencePattern           =28         # from enum OlObjectClass
	olReminder                    =101        # from enum OlObjectClass
	olReminders                   =100        # from enum OlObjectClass
	olRemote                      =47         # from enum OlObjectClass
	olReport                      =46         # from enum OlObjectClass
	olResults                     =78         # from enum OlObjectClass
	olRow                         =121        # from enum OlObjectClass
	olRule                        =115        # from enum OlObjectClass
	olRuleAction                  =117        # from enum OlObjectClass
	olRuleActions                 =116        # from enum OlObjectClass
	olRuleCondition               =127        # from enum OlObjectClass
	olRuleConditions              =126        # from enum OlObjectClass
	olRules                       =114        # from enum OlObjectClass
	olSearch                      =77         # from enum OlObjectClass
	olSelectNamesDialog           =109        # from enum OlObjectClass
	olSelection                   =74         # from enum OlObjectClass
	olSendRuleAction              =119        # from enum OlObjectClass
	olSenderInAddressListRuleCondition=133        # from enum OlObjectClass
	olSensitivityRuleCondition    =186        # from enum OlObjectClass
	olSharing                     =104        # from enum OlObjectClass
	olSimpleItems                 =179        # from enum OlObjectClass
	olSolutionsModule             =177        # from enum OlObjectClass
	olStorageItem                 =113        # from enum OlObjectClass
	olStore                       =107        # from enum OlObjectClass
	olStores                      =108        # from enum OlObjectClass
	olSyncObject                  =72         # from enum OlObjectClass
	olSyncObjects                 =73         # from enum OlObjectClass
	olTable                       =120        # from enum OlObjectClass
	olTask                        =48         # from enum OlObjectClass
	olTaskRequest                 =49         # from enum OlObjectClass
	olTaskRequestAccept           =51         # from enum OlObjectClass
	olTaskRequestDecline          =52         # from enum OlObjectClass
	olTaskRequestUpdate           =50         # from enum OlObjectClass
	olTasksModule                 =161        # from enum OlObjectClass
	olTextRuleCondition           =134        # from enum OlObjectClass
	olUserDefinedProperties       =172        # from enum OlObjectClass
	olUserDefinedProperty         =171        # from enum OlObjectClass
	olUserProperties              =38         # from enum OlObjectClass
	olUserProperty                =39         # from enum OlObjectClass
	olView                        =80         # from enum OlObjectClass
	olViewField                   =142        # from enum OlObjectClass
	olViewFields                  =141        # from enum OlObjectClass
	olViewFont                    =146        # from enum OlObjectClass
	olViews                       =79         # from enum OlObjectClass
	olExcelWorkSheetItem          =8          # from enum OlOfficeDocItemsType
	olPowerPointShowItem          =10         # from enum OlOfficeDocItemsType
	olWordDocumentItem            =9          # from enum OlOfficeDocItemsType
	olLargeIcon                   =0          # from enum OlOutlookBarViewType
	olSmallIcon                   =1          # from enum OlOutlookBarViewType
	olPageTypePlanner             =0          # from enum OlPageType
	olPageTypeTracker             =1          # from enum OlPageType
	olFolderList                  =2          # from enum OlPane
	olNavigationPane              =4          # from enum OlPane
	olOutlookBar                  =1          # from enum OlPane
	olPreview                     =3          # from enum OlPane
	olToDoBar                     =5          # from enum OlPane
	olDoNotForward                =1          # from enum OlPermission
	olEncryptOnly                 =3          # from enum OlPermission
	olPermissionTemplate          =2          # from enum OlPermission
	olUnrestricted                =0          # from enum OlPermission
	olPassport                    =2          # from enum OlPermissionService
	olUnknown                     =0          # from enum OlPermissionService
	olWindows                     =1          # from enum OlPermissionService
	olPictureAlignmentLeft        =0          # from enum OlPictureAlignment
	olPictureAlignmentTop         =1          # from enum OlPictureAlignment
	olShowNone                    =0          # from enum OlRecipientSelectors
	olShowTo                      =1          # from enum OlRecipientSelectors
	olShowToCc                    =2          # from enum OlRecipientSelectors
	olShowToCcBcc                 =3          # from enum OlRecipientSelectors
	olApptException               =3          # from enum OlRecurrenceState
	olApptMaster                  =1          # from enum OlRecurrenceState
	olApptNotRecurring            =0          # from enum OlRecurrenceState
	olApptOccurrence              =2          # from enum OlRecurrenceState
	olRecursDaily                 =0          # from enum OlRecurrenceType
	olRecursMonthNth              =3          # from enum OlRecurrenceType
	olRecursMonthly               =2          # from enum OlRecurrenceType
	olRecursWeekly                =1          # from enum OlRecurrenceType
	olRecursYearNth               =6          # from enum OlRecurrenceType
	olRecursYearly                =5          # from enum OlRecurrenceType
	olStrong                      =1          # from enum OlReferenceType
	olWeak                        =0          # from enum OlReferenceType
	olMarkedForCopy               =3          # from enum OlRemoteStatus
	olMarkedForDelete             =4          # from enum OlRemoteStatus
	olMarkedForDownload           =2          # from enum OlRemoteStatus
	olRemoteStatusNone            =0          # from enum OlRemoteStatus
	olUnMarked                    =1          # from enum OlRemoteStatus
	olResponseAccepted            =3          # from enum OlResponseStatus
	olResponseDeclined            =4          # from enum OlResponseStatus
	olResponseNone                =0          # from enum OlResponseStatus
	olResponseNotResponded        =5          # from enum OlResponseStatus
	olResponseOrganized           =1          # from enum OlResponseStatus
	olResponseTentative           =2          # from enum OlResponseStatus
	olRuleActionAssignToCategory  =2          # from enum OlRuleActionType
	olRuleActionCcMessage         =27         # from enum OlRuleActionType
	olRuleActionClearCategories   =30         # from enum OlRuleActionType
	olRuleActionCopyToFolder      =5          # from enum OlRuleActionType
	olRuleActionCustomAction      =22         # from enum OlRuleActionType
	olRuleActionDefer             =28         # from enum OlRuleActionType
	olRuleActionDelete            =3          # from enum OlRuleActionType
	olRuleActionDeletePermanently =4          # from enum OlRuleActionType
	olRuleActionDesktopAlert      =24         # from enum OlRuleActionType
	olRuleActionFlagClear         =13         # from enum OlRuleActionType
	olRuleActionFlagColor         =12         # from enum OlRuleActionType
	olRuleActionFlagForActionInDays=11         # from enum OlRuleActionType
	olRuleActionForward           =6          # from enum OlRuleActionType
	olRuleActionForwardAsAttachment=7          # from enum OlRuleActionType
	olRuleActionImportance        =14         # from enum OlRuleActionType
	olRuleActionMarkAsTask        =29         # from enum OlRuleActionType
	olRuleActionMarkRead          =19         # from enum OlRuleActionType
	olRuleActionMoveToFolder      =1          # from enum OlRuleActionType
	olRuleActionNewItemAlert      =23         # from enum OlRuleActionType
	olRuleActionNotifyDelivery    =26         # from enum OlRuleActionType
	olRuleActionNotifyRead        =25         # from enum OlRuleActionType
	olRuleActionPlaySound         =17         # from enum OlRuleActionType
	olRuleActionPrint             =16         # from enum OlRuleActionType
	olRuleActionRedirect          =8          # from enum OlRuleActionType
	olRuleActionRunScript         =20         # from enum OlRuleActionType
	olRuleActionSensitivity       =15         # from enum OlRuleActionType
	olRuleActionServerReply       =9          # from enum OlRuleActionType
	olRuleActionStartApplication  =18         # from enum OlRuleActionType
	olRuleActionStop              =21         # from enum OlRuleActionType
	olRuleActionTemplate          =10         # from enum OlRuleActionType
	olRuleActionUnknown           =0          # from enum OlRuleActionType
	olConditionAccount            =3          # from enum OlRuleConditionType
	olConditionAnyCategory        =29         # from enum OlRuleConditionType
	olConditionBody               =13         # from enum OlRuleConditionType
	olConditionBodyOrSubject      =14         # from enum OlRuleConditionType
	olConditionCategory           =18         # from enum OlRuleConditionType
	olConditionCc                 =9          # from enum OlRuleConditionType
	olConditionDateRange          =22         # from enum OlRuleConditionType
	olConditionFlaggedForAction   =8          # from enum OlRuleConditionType
	olConditionFormName           =23         # from enum OlRuleConditionType
	olConditionFrom               =1          # from enum OlRuleConditionType
	olConditionFromAnyRssFeed     =31         # from enum OlRuleConditionType
	olConditionFromRssFeed        =30         # from enum OlRuleConditionType
	olConditionHasAttachment      =20         # from enum OlRuleConditionType
	olConditionImportance         =6          # from enum OlRuleConditionType
	olConditionLocalMachineOnly   =27         # from enum OlRuleConditionType
	olConditionMeetingInviteOrUpdate=26         # from enum OlRuleConditionType
	olConditionMessageHeader      =15         # from enum OlRuleConditionType
	olConditionNotTo              =11         # from enum OlRuleConditionType
	olConditionOOF                =19         # from enum OlRuleConditionType
	olConditionOnlyToMe           =4          # from enum OlRuleConditionType
	olConditionOtherMachine       =28         # from enum OlRuleConditionType
	olConditionProperty           =24         # from enum OlRuleConditionType
	olConditionRecipientAddress   =16         # from enum OlRuleConditionType
	olConditionSenderAddress      =17         # from enum OlRuleConditionType
	olConditionSenderInAddressBook=25         # from enum OlRuleConditionType
	olConditionSensitivity        =7          # from enum OlRuleConditionType
	olConditionSentTo             =12         # from enum OlRuleConditionType
	olConditionSizeRange          =21         # from enum OlRuleConditionType
	olConditionSubject            =2          # from enum OlRuleConditionType
	olConditionTo                 =5          # from enum OlRuleConditionType
	olConditionToOrCc             =10         # from enum OlRuleConditionType
	olConditionUnknown            =0          # from enum OlRuleConditionType
	olRuleExecuteAllMessages      =0          # from enum OlRuleExecuteOption
	olRuleExecuteReadMessages     =1          # from enum OlRuleExecuteOption
	olRuleExecuteUnreadMessages   =2          # from enum OlRuleExecuteOption
	olRuleReceive                 =0          # from enum OlRuleType
	olRuleSend                    =1          # from enum OlRuleType
	olDoc                         =4          # from enum OlSaveAsType
	olHTML                        =5          # from enum OlSaveAsType
	olICal                        =8          # from enum OlSaveAsType
	olMHTML                       =10         # from enum OlSaveAsType
	olMSG                         =3          # from enum OlSaveAsType
	olMSGUnicode                  =9          # from enum OlSaveAsType
	olRTF                         =1          # from enum OlSaveAsType
	olTXT                         =0          # from enum OlSaveAsType
	olTemplate                    =2          # from enum OlSaveAsType
	olVCal                        =7          # from enum OlSaveAsType
	olVCard                       =6          # from enum OlSaveAsType
	olScrollBarsBoth              =3          # from enum OlScrollBars
	olScrollBarsHorizontal        =1          # from enum OlScrollBars
	olScrollBarsNone              =0          # from enum OlScrollBars
	olScrollBarsVertical          =2          # from enum OlScrollBars
	olSearchScopeAllFolders       =1          # from enum OlSearchScope
	olSearchScopeAllOutlookItems  =2          # from enum OlSearchScope
	olSearchScopeCurrentFolder    =0          # from enum OlSearchScope
	olSearchScopeCurrentStore     =4          # from enum OlSearchScope
	olSearchScopeSubfolders       =3          # from enum OlSearchScope
	olConversationHeaders         =1          # from enum OlSelectionContents
	olAttachmentWell              =4          # from enum OlSelectionLocation
	olDailyTaskList               =3          # from enum OlSelectionLocation
	olToDoBarAppointmentList      =2          # from enum OlSelectionLocation
	olToDoBarTaskList             =1          # from enum OlSelectionLocation
	olViewList                    =0          # from enum OlSelectionLocation
	olConfidential                =3          # from enum OlSensitivity
	olNormal                      =0          # from enum OlSensitivity
	olPersonal                    =1          # from enum OlSensitivity
	olPrivate                     =2          # from enum OlSensitivity
	olSharingMsgTypeInvite        =2          # from enum OlSharingMsgType
	olSharingMsgTypeInviteAndRequest=3          # from enum OlSharingMsgType
	olSharingMsgTypeRequest       =1          # from enum OlSharingMsgType
	olSharingMsgTypeResponseAllow =4          # from enum OlSharingMsgType
	olSharingMsgTypeResponseDeny  =5          # from enum OlSharingMsgType
	olSharingMsgTypeUnknown       =0          # from enum OlSharingMsgType
	olProviderExchange            =1          # from enum OlSharingProvider
	olProviderFederate            =7          # from enum OlSharingProvider
	olProviderICal                =4          # from enum OlSharingProvider
	olProviderPubCal              =3          # from enum OlSharingProvider
	olProviderRSS                 =6          # from enum OlSharingProvider
	olProviderSharePoint          =5          # from enum OlSharingProvider
	olProviderUnknown             =0          # from enum OlSharingProvider
	olProviderWebCal              =2          # from enum OlSharingProvider
	olShiftStateAltMask           =4          # from enum OlShiftState
	olShiftStateCtrlMask          =2          # from enum OlShiftState
	olShiftStateShiftMask         =1          # from enum OlShiftState
	olNoItemCount                 =0          # from enum OlShowItemCount
	olShowTotalItemCount          =2          # from enum OlShowItemCount
	olShowUnreadItemCount         =1          # from enum OlShowItemCount
	olHideInDefaultModules        =0          # from enum OlSolutionScope
	olShowInDefaultModules        =1          # from enum OlSolutionScope
	olAscending                   =1          # from enum OlSortOrder
	olDescending                  =2          # from enum OlSortOrder
	olSortNone                    =0          # from enum OlSortOrder
	olSpecialFolderAllTasks       =0          # from enum OlSpecialFolders
	olSpecialFolderReminders      =1          # from enum OlSpecialFolders
	olIdentifyByEntryID           =1          # from enum OlStorageIdentifierType
	olIdentifyByMessageClass      =2          # from enum OlStorageIdentifierType
	olIdentifyBySubject           =0          # from enum OlStorageIdentifierType
	olStoreANSI                   =3          # from enum OlStoreType
	olStoreDefault                =1          # from enum OlStoreType
	olStoreUnicode                =2          # from enum OlStoreType
	olSyncStarted                 =1          # from enum OlSyncState
	olSyncStopped                 =0          # from enum OlSyncState
	olHiddenItems                 =1          # from enum OlTableContents
	olUserItems                   =0          # from enum OlTableContents
	olTaskDelegationAccepted      =2          # from enum OlTaskDelegationState
	olTaskDelegationDeclined      =3          # from enum OlTaskDelegationState
	olTaskDelegationUnknown       =1          # from enum OlTaskDelegationState
	olTaskNotDelegated            =0          # from enum OlTaskDelegationState
	olDelegatedTask               =1          # from enum OlTaskOwnership
	olNewTask                     =0          # from enum OlTaskOwnership
	olOwnTask                     =2          # from enum OlTaskOwnership
	olFinalStatus                 =3          # from enum OlTaskRecipientType
	olUpdate                      =2          # from enum OlTaskRecipientType
	olTaskAccept                  =2          # from enum OlTaskResponse
	olTaskAssign                  =1          # from enum OlTaskResponse
	olTaskDecline                 =3          # from enum OlTaskResponse
	olTaskSimple                  =0          # from enum OlTaskResponse
	olTaskComplete                =2          # from enum OlTaskStatus
	olTaskDeferred                =4          # from enum OlTaskStatus
	olTaskInProgress              =1          # from enum OlTaskStatus
	olTaskNotStarted              =0          # from enum OlTaskStatus
	olTaskWaiting                 =3          # from enum OlTaskStatus
	olTextAlignCenter             =2          # from enum OlTextAlign
	olTextAlignLeft               =1          # from enum OlTextAlign
	olTextAlignRight              =3          # from enum OlTextAlign
	olTimeStyleShortDuration      =4          # from enum OlTimeStyle
	olTimeStyleTimeDuration       =1          # from enum OlTimeStyle
	olTimeStyleTimeOnly           =0          # from enum OlTimeStyle
	olTimelineViewDay             =0          # from enum OlTimelineViewMode
	olTimelineViewMonth           =2          # from enum OlTimelineViewMode
	olTimelineViewWeek            =1          # from enum OlTimelineViewMode
	olTrackingDelivered           =1          # from enum OlTrackingStatus
	olTrackingNone                =0          # from enum OlTrackingStatus
	olTrackingNotDelivered        =2          # from enum OlTrackingStatus
	olTrackingNotRead             =3          # from enum OlTrackingStatus
	olTrackingRead                =6          # from enum OlTrackingStatus
	olTrackingRecallFailure       =4          # from enum OlTrackingStatus
	olTrackingRecallSuccess       =5          # from enum OlTrackingStatus
	olTrackingReplied             =7          # from enum OlTrackingStatus
	olGroupCalendarFolder         =1          # from enum OlUnifiedGroupFolderType
	olGroupMailFolder             =0          # from enum OlUnifiedGroupFolderType
	PrivateGroup                  =1          # from enum OlUnifiedGroupType
	PublicGroup                   =2          # from enum OlUnifiedGroupType
	olCombination                 =19         # from enum OlUserPropertyType
	olCurrency                    =14         # from enum OlUserPropertyType
	olDateTime                    =5          # from enum OlUserPropertyType
	olDuration                    =7          # from enum OlUserPropertyType
	olEnumeration                 =21         # from enum OlUserPropertyType
	olFormula                     =18         # from enum OlUserPropertyType
	olInteger                     =20         # from enum OlUserPropertyType
	olKeywords                    =11         # from enum OlUserPropertyType
	olNumber                      =3          # from enum OlUserPropertyType
	olOutlookInternal             =0          # from enum OlUserPropertyType
	olPercent                     =12         # from enum OlUserPropertyType
	olSmartFrom                   =22         # from enum OlUserPropertyType
	olText                        =1          # from enum OlUserPropertyType
	olYesNo                       =6          # from enum OlUserPropertyType
	olVerticalLayoutAlignBottom   =2          # from enum OlVerticalLayout
	olVerticalLayoutAlignMiddle   =1          # from enum OlVerticalLayout
	olVerticalLayoutAlignTop      =0          # from enum OlVerticalLayout
	olVerticalLayoutGrow          =3          # from enum OlVerticalLayout
	olViewSaveOptionAllFoldersOfType=2          # from enum OlViewSaveOption
	olViewSaveOptionThisFolderEveryone=0          # from enum OlViewSaveOption
	olViewSaveOptionThisFolderOnlyMe=1          # from enum OlViewSaveOption
	olBusinessCardView            =5          # from enum OlViewType
	olCalendarView                =2          # from enum OlViewType
	olCardView                    =1          # from enum OlViewType
	olDailyTaskListView           =6          # from enum OlViewType
	olIconView                    =3          # from enum OlViewType
	olMessageListView             =9          # from enum OlViewType
	olPeopleView                  =7          # from enum OlViewType
	olSearchView                  =10         # from enum OlViewType
	olTableView                   =0          # from enum OlViewType
	olThreadView                  =8          # from enum OlViewType
	olTimelineView                =4          # from enum OlViewType
	olMaximized                   =0          # from enum OlWindowState
	olMinimized                   =1          # from enum OlWindowState
	olNormalWindow                =2          # from enum OlWindowState

RecordMap = {
}

CLSIDToClassMap = {}
CLSIDToPackageMap = {
	'{D87E7E16-6897-11CE-A6C0-00AA00608FAA}' : '_IRecipientControl',
	'{0006F025-0000-0000-C000-000000000046}' : '_DRecipientControl',
	'{D87E7E17-6897-11CE-A6C0-00AA00608FAA}' : '_DRecipientControlEvents',
	'{0006F023-0000-0000-C000-000000000046}' : '_RecipientControl',
	'{43507DD0-811D-11CE-B565-00AA00608FAA}' : '_IDocSiteControl',
	'{0006F026-0000-0000-C000-000000000046}' : '_DDocSiteControl',
	'{50BB9B50-811D-11CE-B565-00AA00608FAA}' : '_DDocSiteControlEvents',
	'{0006F024-0000-0000-C000-000000000046}' : '_DocSiteControl',
	'{00067366-0000-0000-C000-000000000046}' : 'OlkControl',
	'{000672DA-0000-0000-C000-000000000046}' : '_OlkTextBox',
	'{000672E6-0000-0000-C000-000000000046}' : 'OlkTextBoxEvents',
	'{0006F068-0000-0000-C000-000000000046}' : 'OlkTextBox',
	'{000672D9-0000-0000-C000-000000000046}' : '_OlkLabel',
	'{000672E5-0000-0000-C000-000000000046}' : 'OlkLabelEvents',
	'{0006F067-0000-0000-C000-000000000046}' : 'OlkLabel',
	'{000672DB-0000-0000-C000-000000000046}' : '_OlkCommandButton',
	'{000672E0-0000-0000-C000-000000000046}' : 'OlkCommandButtonEvents',
	'{0006F04A-0000-0000-C000-000000000046}' : 'OlkCommandButton',
	'{000672DD-0000-0000-C000-000000000046}' : '_OlkCheckBox',
	'{000672E2-0000-0000-C000-000000000046}' : 'OlkCheckBoxEvents',
	'{0006F04C-0000-0000-C000-000000000046}' : 'OlkCheckBox',
	'{000672DC-0000-0000-C000-000000000046}' : '_OlkOptionButton',
	'{000672E1-0000-0000-C000-000000000046}' : 'OlkOptionButtonEvents',
	'{0006F04B-0000-0000-C000-000000000046}' : 'OlkOptionButton',
	'{000672DE-0000-0000-C000-000000000046}' : '_OlkComboBox',
	'{000672E3-0000-0000-C000-000000000046}' : 'OlkComboBoxEvents',
	'{0006F04D-0000-0000-C000-000000000046}' : 'OlkComboBox',
	'{000672DF-0000-0000-C000-000000000046}' : '_OlkListBox',
	'{000672E4-0000-0000-C000-000000000046}' : 'OlkListBoxEvents',
	'{0006F04E-0000-0000-C000-000000000046}' : 'OlkListBox',
	'{000672F6-0000-0000-C000-000000000046}' : '_OlkInfoBar',
	'{000672F7-0000-0000-C000-000000000046}' : 'OlkInfoBarEvents',
	'{0006F054-0000-0000-C000-000000000046}' : 'OlkInfoBar',
	'{000672EB-0000-0000-C000-000000000046}' : '_OlkContactPhoto',
	'{000672EC-0000-0000-C000-000000000046}' : 'OlkContactPhotoEvents',
	'{0006F04F-0000-0000-C000-000000000046}' : 'OlkContactPhoto',
	'{000672ED-0000-0000-C000-000000000046}' : '_OlkBusinessCardControl',
	'{000672EE-0000-0000-C000-000000000046}' : 'OlkBusinessCardControlEvents',
	'{0006F050-0000-0000-C000-000000000046}' : 'OlkBusinessCardControl',
	'{000672F8-0000-0000-C000-000000000046}' : '_OlkPageControl',
	'{000672F9-0000-0000-C000-000000000046}' : 'OlkPageControlEvents',
	'{0006F055-0000-0000-C000-000000000046}' : 'OlkPageControl',
	'{000672FA-0000-0000-C000-000000000046}' : '_OlkDateControl',
	'{000672FB-0000-0000-C000-000000000046}' : 'OlkDateControlEvents',
	'{0006F056-0000-0000-C000-000000000046}' : 'OlkDateControl',
	'{000672EF-0000-0000-C000-000000000046}' : '_OlkTimeControl',
	'{000672F0-0000-0000-C000-000000000046}' : 'OlkTimeControlEvents',
	'{0006F051-0000-0000-C000-000000000046}' : 'OlkTimeControl',
	'{000672F4-0000-0000-C000-000000000046}' : '_OlkCategory',
	'{000672F5-0000-0000-C000-000000000046}' : 'OlkCategoryEvents',
	'{0006F053-0000-0000-C000-000000000046}' : 'OlkCategory',
	'{00067352-0000-0000-C000-000000000046}' : '_OlkFrameHeader',
	'{00067353-0000-0000-C000-000000000046}' : 'OlkFrameHeaderEvents',
	'{0006F057-0000-0000-C000-000000000046}' : 'OlkFrameHeader',
	'{00067355-0000-0000-C000-000000000046}' : '_OlkSenderPhoto',
	'{00067356-0000-0000-C000-000000000046}' : 'OlkSenderPhotoEvents',
	'{0006F058-0000-0000-C000-000000000046}' : 'OlkSenderPhoto',
	'{000630FD-0000-0000-C000-000000000046}' : '_TimeZone',
	'{00063001-0000-0000-C000-000000000046}' : '_Application',
	'{00063002-0000-0000-C000-000000000046}' : '_NameSpace',
	'{00063045-0000-0000-C000-000000000046}' : 'Recipient',
	'{0006304B-0000-0000-C000-000000000046}' : 'AddressEntry',
	'{0006304A-0000-0000-C000-000000000046}' : 'AddressEntries',
	'{00063021-0000-0000-C000-000000000046}' : '_ContactItem',
	'{0006303E-0000-0000-C000-000000000046}' : 'Actions',
	'{00063043-0000-0000-C000-000000000046}' : 'Action',
	'{0006303C-0000-0000-C000-000000000046}' : 'Attachments',
	'{00063007-0000-0000-C000-000000000046}' : 'Attachment',
	'{0006302D-0000-0000-C000-000000000046}' : '_PropertyAccessor',
	'{0006102D-0000-0000-C000-000000000046}' : 'PropertyAccessor',
	'{00063046-0000-0000-C000-000000000046}' : 'FormDescription',
	'{00063005-0000-0000-C000-000000000046}' : '_Inspector',
	'{000630F9-0000-0000-C000-000000000046}' : '_AttachmentSelection',
	'{00063087-0000-0000-C000-000000000046}' : 'Selection',
	'{0006303D-0000-0000-C000-000000000046}' : 'UserProperties',
	'{00063042-0000-0000-C000-000000000046}' : 'UserProperty',
	'{00063006-0000-0000-C000-000000000046}' : 'MAPIFolder',
	'{00063040-0000-0000-C000-000000000046}' : '_Folders',
	'{00063041-0000-0000-C000-000000000046}' : '_Items',
	'{00063003-0000-0000-C000-000000000046}' : '_Explorer',
	'{00063009-0000-0000-C000-000000000046}' : 'Panes',
	'{000630E6-0000-0000-C000-000000000046}' : '_NavigationPane',
	'{000630E8-0000-0000-C000-000000000046}' : '_NavigationModule',
	'{000610E8-0000-0000-C000-000000000046}' : 'NavigationModule',
	'{000630E7-0000-0000-C000-000000000046}' : '_NavigationModules',
	'{000610E7-0000-0000-C000-000000000046}' : 'NavigationModules',
	'{00063103-0000-0000-C000-000000000046}' : '_AccountSelector',
	'{000630C5-0000-0000-C000-000000000046}' : '_Account',
	'{000630C7-0000-0000-C000-000000000046}' : '_Store',
	'{000610C7-0000-0000-C000-000000000046}' : 'Store',
	'{000630CC-0000-0000-C000-000000000046}' : '_Rules',
	'{000610CC-0000-0000-C000-000000000046}' : 'Rules',
	'{000630CD-0000-0000-C000-000000000046}' : '_Rule',
	'{000630CE-0000-0000-C000-000000000046}' : '_RuleActions',
	'{000610CE-0000-0000-C000-000000000046}' : 'RuleActions',
	'{000630CF-0000-0000-C000-000000000046}' : '_RuleAction',
	'{000630D0-0000-0000-C000-000000000046}' : '_MoveOrCopyRuleAction',
	'{000610D0-0000-0000-C000-000000000046}' : 'MoveOrCopyRuleAction',
	'{000610CF-0000-0000-C000-000000000046}' : 'RuleAction',
	'{000630D1-0000-0000-C000-000000000046}' : '_SendRuleAction',
	'{000610D1-0000-0000-C000-000000000046}' : 'SendRuleAction',
	'{0006303B-0000-0000-C000-000000000046}' : 'Recipients',
	'{000630D4-0000-0000-C000-000000000046}' : '_AssignToCategoryRuleAction',
	'{000610D4-0000-0000-C000-000000000046}' : 'AssignToCategoryRuleAction',
	'{000630D5-0000-0000-C000-000000000046}' : '_PlaySoundRuleAction',
	'{000610D5-0000-0000-C000-000000000046}' : 'PlaySoundRuleAction',
	'{000630D6-0000-0000-C000-000000000046}' : '_MarkAsTaskRuleAction',
	'{000610D6-0000-0000-C000-000000000046}' : 'MarkAsTaskRuleAction',
	'{000630D7-0000-0000-C000-000000000046}' : '_NewItemAlertRuleAction',
	'{000610D7-0000-0000-C000-000000000046}' : 'NewItemAlertRuleAction',
	'{000630D8-0000-0000-C000-000000000046}' : '_RuleConditions',
	'{000610D8-0000-0000-C000-000000000046}' : 'RuleConditions',
	'{000630D9-0000-0000-C000-000000000046}' : '_RuleCondition',
	'{000610D9-0000-0000-C000-000000000046}' : 'RuleCondition',
	'{000630DA-0000-0000-C000-000000000046}' : '_ImportanceRuleCondition',
	'{000610DA-0000-0000-C000-000000000046}' : 'ImportanceRuleCondition',
	'{000630DB-0000-0000-C000-000000000046}' : '_AccountRuleCondition',
	'{000610DB-0000-0000-C000-000000000046}' : 'AccountRuleCondition',
	'{000610C5-0000-0000-C000-000000000046}' : 'Account',
	'{000630E0-0000-0000-C000-000000000046}' : '_TextRuleCondition',
	'{000610E0-0000-0000-C000-000000000046}' : 'TextRuleCondition',
	'{000630DC-0000-0000-C000-000000000046}' : '_CategoryRuleCondition',
	'{000610DC-0000-0000-C000-000000000046}' : 'CategoryRuleCondition',
	'{000630DD-0000-0000-C000-000000000046}' : '_FormNameRuleCondition',
	'{000610DD-0000-0000-C000-000000000046}' : 'FormNameRuleCondition',
	'{000630DE-0000-0000-C000-000000000046}' : '_ToOrFromRuleCondition',
	'{000610DE-0000-0000-C000-000000000046}' : 'ToOrFromRuleCondition',
	'{000630FA-0000-0000-C000-000000000046}' : '_AddressRuleCondition',
	'{000610FA-0000-0000-C000-000000000046}' : 'AddressRuleCondition',
	'{000630DF-0000-0000-C000-000000000046}' : '_SenderInAddressListRuleCondition',
	'{000610DF-0000-0000-C000-000000000046}' : 'SenderInAddressListRuleCondition',
	'{00063049-0000-0000-C000-000000000046}' : 'AddressList',
	'{000630FB-0000-0000-C000-000000000046}' : '_FromRssFeedRuleCondition',
	'{000610FB-0000-0000-C000-000000000046}' : 'FromRssFeedRuleCondition',
	'{00063108-0000-0000-C000-000000000046}' : '_SensitivityRuleCondition',
	'{00061108-0000-0000-C000-000000000046}' : 'SensitivityRuleCondition',
	'{000610CD-0000-0000-C000-000000000046}' : 'Rule',
	'{000630E4-0000-0000-C000-000000000046}' : '_Categories',
	'{000610E4-0000-0000-C000-000000000046}' : 'Categories',
	'{000630E3-0000-0000-C000-000000000046}' : '_Category',
	'{000610E3-0000-0000-C000-000000000046}' : 'Category',
	'{00063063-0000-0000-C000-000000000046}' : '_PreviewPane',
	'{00063095-0000-0000-C000-000000000046}' : 'View',
	'{0006308D-0000-0000-C000-000000000046}' : '_Views',
	'{000630CB-0000-0000-C000-000000000046}' : '_StorageItem',
	'{000630D2-0000-0000-C000-000000000046}' : '_Table',
	'{000610D2-0000-0000-C000-000000000046}' : 'Table',
	'{000630D3-0000-0000-C000-000000000046}' : '_Row',
	'{000610D3-0000-0000-C000-000000000046}' : 'Row',
	'{000630E1-0000-0000-C000-000000000046}' : '_Columns',
	'{000610E1-0000-0000-C000-000000000046}' : 'Columns',
	'{000630E5-0000-0000-C000-000000000046}' : '_Column',
	'{000610E5-0000-0000-C000-000000000046}' : 'Column',
	'{000630E2-0000-0000-C000-000000000046}' : '_CalendarSharing',
	'{000610E2-0000-0000-C000-000000000046}' : 'CalendarSharing',
	'{00063034-0000-0000-C000-000000000046}' : '_MailItem',
	'{0006303A-0000-0000-C000-000000000046}' : 'ItemEvents',
	'{0006302B-0000-0000-C000-000000000046}' : 'ItemEvents_10',
	'{00061033-0000-0000-C000-000000000046}' : 'MailItem',
	'{0006308A-0000-0000-C000-000000000046}' : 'Links',
	'{00063089-0000-0000-C000-000000000046}' : 'Link',
	'{000630A8-0000-0000-C000-000000000046}' : 'ItemProperties',
	'{000630A7-0000-0000-C000-000000000046}' : 'ItemProperty',
	'{000630C2-0000-0000-C000-000000000046}' : 'Conflicts',
	'{000630C3-0000-0000-C000-000000000046}' : 'Conflict',
	'{00061031-0000-0000-C000-000000000046}' : 'ContactItem',
	'{00063101-0000-0000-C000-000000000046}' : '_Conversation',
	'{00063102-0000-0000-C000-000000000046}' : '_SimpleItems',
	'{00061102-0000-0000-C000-000000000046}' : 'SimpleItems',
	'{00063047-0000-0000-C000-000000000046}' : '_UserDefinedProperties',
	'{00061047-0000-0000-C000-000000000046}' : 'UserDefinedProperties',
	'{0006305C-0000-0000-C000-000000000046}' : '_UserDefinedProperty',
	'{0006105C-0000-0000-C000-000000000046}' : 'UserDefinedProperty',
	'{000630C9-0000-0000-C000-000000000046}' : '_ExchangeUser',
	'{000610C9-0000-0000-C000-000000000046}' : 'ExchangeUser',
	'{000630CA-0000-0000-C000-000000000046}' : '_ExchangeDistributionList',
	'{000610CA-0000-0000-C000-000000000046}' : 'ExchangeDistributionList',
	'{00063048-0000-0000-C000-000000000046}' : 'AddressLists',
	'{00063086-0000-0000-C000-000000000046}' : 'SyncObjects',
	'{00063083-0000-0000-C000-000000000046}' : '_SyncObject',
	'{00063085-0000-0000-C000-000000000046}' : 'SyncObjectEvents',
	'{00063084-0000-0000-C000-000000000046}' : 'SyncObject',
	'{000630C4-0000-0000-C000-000000000046}' : '_Accounts',
	'{00063105-0000-0000-C000-000000000046}' : 'AccountsEvents',
	'{000610C4-0000-0000-C000-000000000046}' : 'Accounts',
	'{000630C6-0000-0000-C000-000000000046}' : '_Stores',
	'{000630F8-0000-0000-C000-000000000046}' : 'StoresEvents_12',
	'{000610C6-0000-0000-C000-000000000046}' : 'Stores',
	'{000630C8-0000-0000-C000-000000000046}' : '_SelectNamesDialog',
	'{000610C8-0000-0000-C000-000000000046}' : 'SelectNamesDialog',
	'{0006302F-0000-0000-C000-000000000046}' : '_SharingItem',
	'{00061067-0000-0000-C000-000000000046}' : 'SharingItem',
	'{0006300A-0000-0000-C000-000000000046}' : '_Explorers',
	'{0006304F-0000-0000-C000-000000000046}' : 'ExplorerEvents',
	'{0006300F-0000-0000-C000-000000000046}' : 'ExplorerEvents_10',
	'{00063050-0000-0000-C000-000000000046}' : 'Explorer',
	'{00063008-0000-0000-C000-000000000046}' : '_Inspectors',
	'{0006307D-0000-0000-C000-000000000046}' : 'InspectorEvents',
	'{0006302A-0000-0000-C000-000000000046}' : 'InspectorEvents_10',
	'{00063058-0000-0000-C000-000000000046}' : 'Inspector',
	'{0006300B-0000-0000-C000-000000000046}' : 'Search',
	'{0006300C-0000-0000-C000-000000000046}' : '_Results',
	'{000630B1-0000-0000-C000-000000000046}' : '_Reminders',
	'{000630B0-0000-0000-C000-000000000046}' : '_Reminder',
	'{000630FC-0000-0000-C000-000000000046}' : '_TimeZones',
	'{000610FC-0000-0000-C000-000000000046}' : 'TimeZones',
	'{00067367-0000-0000-C000-000000000046}' : '_OlkTimeZoneControl',
	'{00067368-0000-0000-C000-000000000046}' : 'OlkTimeZoneControlEvents',
	'{0006F059-0000-0000-C000-000000000046}' : 'OlkTimeZoneControl',
	'{0006304E-0000-0000-C000-000000000046}' : 'ApplicationEvents',
	'{00063080-0000-0000-C000-000000000046}' : 'PropertyPages',
	'{00063044-0000-0000-C000-000000000046}' : 'RecurrencePattern',
	'{0006304C-0000-0000-C000-000000000046}' : 'Exceptions',
	'{0006304D-0000-0000-C000-000000000046}' : 'Exception',
	'{00063033-0000-0000-C000-000000000046}' : '_AppointmentItem',
	'{00061030-0000-0000-C000-000000000046}' : 'AppointmentItem',
	'{00063062-0000-0000-C000-000000000046}' : '_MeetingItem',
	'{00061036-0000-0000-C000-000000000046}' : 'MeetingItem',
	'{00063078-0000-0000-C000-000000000046}' : 'ExplorersEvents',
	'{00063076-0000-0000-C000-000000000046}' : 'FoldersEvents',
	'{00063079-0000-0000-C000-000000000046}' : 'InspectorsEvents',
	'{00063077-0000-0000-C000-000000000046}' : 'ItemsEvents',
	'{0006308C-0000-0000-C000-000000000046}' : 'NameSpaceEvents',
	'{00063073-0000-0000-C000-000000000046}' : 'OutlookBarGroup',
	'{00063074-0000-0000-C000-000000000046}' : '_OutlookBarShortcuts',
	'{00063075-0000-0000-C000-000000000046}' : 'OutlookBarShortcut',
	'{00063072-0000-0000-C000-000000000046}' : '_OutlookBarGroups',
	'{0006307B-0000-0000-C000-000000000046}' : 'OutlookBarGroupsEvents',
	'{00063070-0000-0000-C000-000000000046}' : '_OutlookBarPane',
	'{00063071-0000-0000-C000-000000000046}' : 'OutlookBarStorage',
	'{0006307A-0000-0000-C000-000000000046}' : 'OutlookBarPaneEvents',
	'{0006307C-0000-0000-C000-000000000046}' : 'OutlookBarShortcutsEvents',
	'{0006307E-0000-0000-C000-000000000046}' : 'PropertyPage',
	'{0006307F-0000-0000-C000-000000000046}' : 'PropertyPageSite',
	'{0006303F-0000-0000-C000-000000000046}' : 'Pages',
	'{0006300E-0000-0000-C000-000000000046}' : 'ApplicationEvents_10',
	'{0006302C-0000-0000-C000-000000000046}' : 'ApplicationEvents_11',
	'{000610F9-0000-0000-C000-000000000046}' : 'AttachmentSelection',
	'{000630F7-0000-0000-C000-000000000046}' : 'MAPIFolderEvents_12',
	'{000610F7-0000-0000-C000-000000000046}' : 'Folder',
	'{0006300D-0000-0000-C000-000000000046}' : 'ResultsEvents',
	'{000630A5-0000-0000-C000-000000000046}' : '_ViewsEvents',
	'{000630B2-0000-0000-C000-000000000046}' : 'ReminderCollectionEvents',
	'{00063020-0000-0000-C000-000000000046}' : '_DocumentItem',
	'{00063025-0000-0000-C000-000000000046}' : '_NoteItem',
	'{0006305B-0000-0000-C000-000000000046}' : 'FormRegionEvents',
	'{000630A0-0000-0000-C000-000000000046}' : '_ViewField',
	'{0006309E-0000-0000-C000-000000000046}' : '_ColumnFormat',
	'{0006109E-0000-0000-C000-000000000046}' : 'ColumnFormat',
	'{000630A1-0000-0000-C000-000000000046}' : '_ViewFields',
	'{0006F09F-0000-0000-C000-000000000046}' : 'ViewField',
	'{00063097-0000-0000-C000-000000000046}' : '_IconView',
	'{0006309A-0000-0000-C000-000000000046}' : '_OrderFields',
	'{0006109A-0000-0000-C000-000000000046}' : 'OrderFields',
	'{0006309B-0000-0000-C000-000000000046}' : '_OrderField',
	'{0006109B-0000-0000-C000-000000000046}' : 'OrderField',
	'{00063098-0000-0000-C000-000000000046}' : '_CardView',
	'{000610A1-0000-0000-C000-000000000046}' : 'ViewFields',
	'{0006309D-0000-0000-C000-000000000046}' : '_ViewFont',
	'{0006109D-0000-0000-C000-000000000046}' : 'ViewFont',
	'{00063094-0000-0000-C000-000000000046}' : '_AutoFormatRules',
	'{0006F0A2-0000-0000-C000-000000000046}' : 'AutoFormatRules',
	'{00063093-0000-0000-C000-000000000046}' : '_AutoFormatRule',
	'{0006F0A1-0000-0000-C000-000000000046}' : 'AutoFormatRule',
	'{0006309C-0000-0000-C000-000000000046}' : '_TimelineView',
	'{000630E9-0000-0000-C000-000000000046}' : '_MailModule',
	'{000630EF-0000-0000-C000-000000000046}' : '_NavigationGroups',
	'{000630F0-0000-0000-C000-000000000046}' : '_NavigationGroup',
	'{000630F1-0000-0000-C000-000000000046}' : '_NavigationFolders',
	'{000610F1-0000-0000-C000-000000000046}' : 'NavigationFolders',
	'{000630F2-0000-0000-C000-000000000046}' : '_NavigationFolder',
	'{000610F2-0000-0000-C000-000000000046}' : 'NavigationFolder',
	'{000610F0-0000-0000-C000-000000000046}' : 'NavigationGroup',
	'{000630EA-0000-0000-C000-000000000046}' : '_CalendarModule',
	'{000630EB-0000-0000-C000-000000000046}' : '_ContactsModule',
	'{000630EC-0000-0000-C000-000000000046}' : '_TasksModule',
	'{000630ED-0000-0000-C000-000000000046}' : '_JournalModule',
	'{000630EE-0000-0000-C000-000000000046}' : '_NotesModule',
	'{000630F3-0000-0000-C000-000000000046}' : 'NavigationPaneEvents_12',
	'{000630F4-0000-0000-C000-000000000046}' : 'NavigationGroupsEvents_12',
	'{000630A2-0000-0000-C000-000000000046}' : '_BusinessCardView',
	'{00063059-0000-0000-C000-000000000046}' : '_FormRegionStartup',
	'{0006305A-0000-0000-C000-000000000046}' : '_FormRegion',
	'{0006315A-0000-0000-C000-000000000046}' : 'FormRegion',
	'{000630FF-0000-0000-C000-000000000046}' : '_SolutionsModule',
	'{00063099-0000-0000-C000-000000000046}' : '_CalendarView',
	'{00063096-0000-0000-C000-000000000046}' : '_TableView',
	'{000630FE-0000-0000-C000-000000000046}' : '_MobileItem',
	'{000610FE-0000-0000-C000-000000000046}' : 'MobileItem',
	'{00063022-0000-0000-C000-000000000046}' : '_JournalItem',
	'{00063024-0000-0000-C000-000000000046}' : '_PostItem',
	'{00063035-0000-0000-C000-000000000046}' : '_TaskItem',
	'{00061032-0000-0000-C000-000000000046}' : 'TaskItem',
	'{00063104-0000-0000-C000-000000000046}' : 'AccountSelectorEvents',
	'{00063081-0000-0000-C000-000000000046}' : '_DistListItem',
	'{00063026-0000-0000-C000-000000000046}' : '_ReportItem',
	'{00063023-0000-0000-C000-000000000046}' : '_RemoteItem',
	'{00063036-0000-0000-C000-000000000046}' : '_TaskRequestItem',
	'{00063038-0000-0000-C000-000000000046}' : '_TaskRequestAcceptItem',
	'{00063039-0000-0000-C000-000000000046}' : '_TaskRequestDeclineItem',
	'{00063037-0000-0000-C000-000000000046}' : '_TaskRequestUpdateItem',
	'{00063107-0000-0000-C000-000000000046}' : '_ConversationHeader',
	'{000630A3-0000-0000-C000-000000000046}' : '_PeopleView',
	'{000630A4-0000-0000-C000-000000000046}' : '_ThreadView',
	'{000630A6-0000-0000-C000-000000000046}' : '_MessageListView',
	'{000630B3-0000-0000-C000-000000000046}' : '_SearchView',
	'{0006F03A-0000-0000-C000-000000000046}' : 'Application',
	'{0006103C-0000-0000-C000-000000000046}' : 'DistListItem',
	'{00061061-0000-0000-C000-000000000046}' : 'DocumentItem',
	'{00063053-0000-0000-C000-000000000046}' : 'Explorers',
	'{00063054-0000-0000-C000-000000000046}' : 'Inspectors',
	'{00063051-0000-0000-C000-000000000046}' : 'Folders',
	'{00063052-0000-0000-C000-000000000046}' : 'Items',
	'{00061037-0000-0000-C000-000000000046}' : 'JournalItem',
	'{0006308B-0000-0000-C000-000000000046}' : 'NameSpace',
	'{00061034-0000-0000-C000-000000000046}' : 'NoteItem',
	'{00063056-0000-0000-C000-000000000046}' : 'OutlookBarGroups',
	'{00063055-0000-0000-C000-000000000046}' : 'OutlookBarPane',
	'{00063057-0000-0000-C000-000000000046}' : 'OutlookBarShortcuts',
	'{0006103A-0000-0000-C000-000000000046}' : 'PostItem',
	'{00061060-0000-0000-C000-000000000046}' : 'RemoteItem',
	'{00061035-0000-0000-C000-000000000046}' : 'ReportItem',
	'{00061052-0000-0000-C000-000000000046}' : 'TaskRequestAcceptItem',
	'{00061053-0000-0000-C000-000000000046}' : 'TaskRequestDeclineItem',
	'{00061050-0000-0000-C000-000000000046}' : 'TaskRequestItem',
	'{00061051-0000-0000-C000-000000000046}' : 'TaskRequestUpdateItem',
	'{00061039-0000-0000-C000-000000000046}' : 'Results',
	'{0006F027-0000-0000-C000-000000000046}' : 'Views',
	'{0006F028-0000-0000-C000-000000000046}' : 'Reminder',
	'{0006F029-0000-0000-C000-000000000046}' : 'Reminders',
	'{000610CB-0000-0000-C000-000000000046}' : 'StorageItem',
	'{000610F3-0000-0000-C000-000000000046}' : 'NavigationPane',
	'{000610F4-0000-0000-C000-000000000046}' : 'NavigationGroups',
	'{000610F8-0000-0000-C000-000000000046}' : 'DoNotUseMeFolder',
	'{00062001-0000-0000-C000-000000000046}' : 'TimelineView',
	'{000610E9-0000-0000-C000-000000000046}' : 'MailModule',
	'{000610EA-0000-0000-C000-000000000046}' : 'CalendarModule',
	'{000610EB-0000-0000-C000-000000000046}' : 'ContactsModule',
	'{000610EC-0000-0000-C000-000000000046}' : 'TasksModule',
	'{000610ED-0000-0000-C000-000000000046}' : 'JournalModule',
	'{000610EE-0000-0000-C000-000000000046}' : 'NotesModule',
	'{00062000-0000-0000-C000-000000000046}' : 'TableView',
	'{00062004-0000-0000-C000-000000000046}' : 'IconView',
	'{00062002-0000-0000-C000-000000000046}' : 'CardView',
	'{00062003-0000-0000-C000-000000000046}' : 'CalendarView',
	'{0006200B-0000-0000-C000-000000000046}' : 'BusinessCardView',
	'{00061059-0000-0000-C000-000000000046}' : 'FormRegionStartup',
	'{000610FD-0000-0000-C000-000000000046}' : 'TimeZone',
	'{000610FF-0000-0000-C000-000000000046}' : 'SolutionsModule',
	'{00061101-0000-0000-C000-000000000046}' : 'Conversation',
	'{00061103-0000-0000-C000-000000000046}' : 'AccountSelector',
	'{00061107-0000-0000-C000-000000000046}' : 'ConversationHeader',
	'{0006200C-0000-0000-C000-000000000046}' : 'PeopleView',
	'{0006200D-0000-0000-C000-000000000046}' : 'ThreadView',
	'{0006F0C5-0000-0000-C000-000000000046}' : 'PreviewPane',
	'{0006200E-0000-0000-C000-000000000046}' : 'MessageListView',
	'{0006200F-0000-0000-C000-000000000046}' : 'SearchView',
}
VTablesToClassMap = {}
VTablesToPackageMap = {
	'{00067366-0000-0000-C000-000000000046}' : 'OlkControl',
	'{000672DA-0000-0000-C000-000000000046}' : '_OlkTextBox',
	'{000672D9-0000-0000-C000-000000000046}' : '_OlkLabel',
	'{000672DB-0000-0000-C000-000000000046}' : '_OlkCommandButton',
	'{000672DD-0000-0000-C000-000000000046}' : '_OlkCheckBox',
	'{000672DC-0000-0000-C000-000000000046}' : '_OlkOptionButton',
	'{000672DE-0000-0000-C000-000000000046}' : '_OlkComboBox',
	'{000672DF-0000-0000-C000-000000000046}' : '_OlkListBox',
	'{000672F6-0000-0000-C000-000000000046}' : '_OlkInfoBar',
	'{000672EB-0000-0000-C000-000000000046}' : '_OlkContactPhoto',
	'{000672ED-0000-0000-C000-000000000046}' : '_OlkBusinessCardControl',
	'{000672F8-0000-0000-C000-000000000046}' : '_OlkPageControl',
	'{000672FA-0000-0000-C000-000000000046}' : '_OlkDateControl',
	'{000672EF-0000-0000-C000-000000000046}' : '_OlkTimeControl',
	'{000672F4-0000-0000-C000-000000000046}' : '_OlkCategory',
	'{00067352-0000-0000-C000-000000000046}' : '_OlkFrameHeader',
	'{00067355-0000-0000-C000-000000000046}' : '_OlkSenderPhoto',
	'{000630FD-0000-0000-C000-000000000046}' : '_TimeZone',
	'{00063001-0000-0000-C000-000000000046}' : '_Application',
	'{00063002-0000-0000-C000-000000000046}' : '_NameSpace',
	'{00063045-0000-0000-C000-000000000046}' : 'Recipient',
	'{0006304B-0000-0000-C000-000000000046}' : 'AddressEntry',
	'{0006304A-0000-0000-C000-000000000046}' : 'AddressEntries',
	'{00063021-0000-0000-C000-000000000046}' : '_ContactItem',
	'{0006303E-0000-0000-C000-000000000046}' : 'Actions',
	'{00063043-0000-0000-C000-000000000046}' : 'Action',
	'{0006303C-0000-0000-C000-000000000046}' : 'Attachments',
	'{00063007-0000-0000-C000-000000000046}' : 'Attachment',
	'{0006302D-0000-0000-C000-000000000046}' : '_PropertyAccessor',
	'{00063046-0000-0000-C000-000000000046}' : 'FormDescription',
	'{00063005-0000-0000-C000-000000000046}' : '_Inspector',
	'{000630F9-0000-0000-C000-000000000046}' : '_AttachmentSelection',
	'{00063087-0000-0000-C000-000000000046}' : 'Selection',
	'{0006303D-0000-0000-C000-000000000046}' : 'UserProperties',
	'{00063042-0000-0000-C000-000000000046}' : 'UserProperty',
	'{00063006-0000-0000-C000-000000000046}' : 'MAPIFolder',
	'{00063040-0000-0000-C000-000000000046}' : '_Folders',
	'{00063041-0000-0000-C000-000000000046}' : '_Items',
	'{00063003-0000-0000-C000-000000000046}' : '_Explorer',
	'{00063009-0000-0000-C000-000000000046}' : 'Panes',
	'{000630E6-0000-0000-C000-000000000046}' : '_NavigationPane',
	'{000630E8-0000-0000-C000-000000000046}' : '_NavigationModule',
	'{000630E7-0000-0000-C000-000000000046}' : '_NavigationModules',
	'{00063103-0000-0000-C000-000000000046}' : '_AccountSelector',
	'{000630C5-0000-0000-C000-000000000046}' : '_Account',
	'{000630C7-0000-0000-C000-000000000046}' : '_Store',
	'{000630CC-0000-0000-C000-000000000046}' : '_Rules',
	'{000630CD-0000-0000-C000-000000000046}' : '_Rule',
	'{000630CE-0000-0000-C000-000000000046}' : '_RuleActions',
	'{000630CF-0000-0000-C000-000000000046}' : '_RuleAction',
	'{000630D0-0000-0000-C000-000000000046}' : '_MoveOrCopyRuleAction',
	'{000630D1-0000-0000-C000-000000000046}' : '_SendRuleAction',
	'{0006303B-0000-0000-C000-000000000046}' : 'Recipients',
	'{000630D4-0000-0000-C000-000000000046}' : '_AssignToCategoryRuleAction',
	'{000630D5-0000-0000-C000-000000000046}' : '_PlaySoundRuleAction',
	'{000630D6-0000-0000-C000-000000000046}' : '_MarkAsTaskRuleAction',
	'{000630D7-0000-0000-C000-000000000046}' : '_NewItemAlertRuleAction',
	'{000630D8-0000-0000-C000-000000000046}' : '_RuleConditions',
	'{000630D9-0000-0000-C000-000000000046}' : '_RuleCondition',
	'{000630DA-0000-0000-C000-000000000046}' : '_ImportanceRuleCondition',
	'{000630DB-0000-0000-C000-000000000046}' : '_AccountRuleCondition',
	'{000630E0-0000-0000-C000-000000000046}' : '_TextRuleCondition',
	'{000630DC-0000-0000-C000-000000000046}' : '_CategoryRuleCondition',
	'{000630DD-0000-0000-C000-000000000046}' : '_FormNameRuleCondition',
	'{000630DE-0000-0000-C000-000000000046}' : '_ToOrFromRuleCondition',
	'{000630FA-0000-0000-C000-000000000046}' : '_AddressRuleCondition',
	'{000630DF-0000-0000-C000-000000000046}' : '_SenderInAddressListRuleCondition',
	'{00063049-0000-0000-C000-000000000046}' : 'AddressList',
	'{000630FB-0000-0000-C000-000000000046}' : '_FromRssFeedRuleCondition',
	'{00063108-0000-0000-C000-000000000046}' : '_SensitivityRuleCondition',
	'{000630E4-0000-0000-C000-000000000046}' : '_Categories',
	'{000630E3-0000-0000-C000-000000000046}' : '_Category',
	'{00063063-0000-0000-C000-000000000046}' : '_PreviewPane',
	'{00063095-0000-0000-C000-000000000046}' : 'View',
	'{0006308D-0000-0000-C000-000000000046}' : '_Views',
	'{000630CB-0000-0000-C000-000000000046}' : '_StorageItem',
	'{000630D2-0000-0000-C000-000000000046}' : '_Table',
	'{000630D3-0000-0000-C000-000000000046}' : '_Row',
	'{000630E1-0000-0000-C000-000000000046}' : '_Columns',
	'{000630E5-0000-0000-C000-000000000046}' : '_Column',
	'{000630E2-0000-0000-C000-000000000046}' : '_CalendarSharing',
	'{00063034-0000-0000-C000-000000000046}' : '_MailItem',
	'{0006308A-0000-0000-C000-000000000046}' : 'Links',
	'{00063089-0000-0000-C000-000000000046}' : 'Link',
	'{000630A8-0000-0000-C000-000000000046}' : 'ItemProperties',
	'{000630A7-0000-0000-C000-000000000046}' : 'ItemProperty',
	'{000630C2-0000-0000-C000-000000000046}' : 'Conflicts',
	'{000630C3-0000-0000-C000-000000000046}' : 'Conflict',
	'{00063101-0000-0000-C000-000000000046}' : '_Conversation',
	'{00063102-0000-0000-C000-000000000046}' : '_SimpleItems',
	'{00063047-0000-0000-C000-000000000046}' : '_UserDefinedProperties',
	'{0006305C-0000-0000-C000-000000000046}' : '_UserDefinedProperty',
	'{000630C9-0000-0000-C000-000000000046}' : '_ExchangeUser',
	'{000630CA-0000-0000-C000-000000000046}' : '_ExchangeDistributionList',
	'{00063048-0000-0000-C000-000000000046}' : 'AddressLists',
	'{00063086-0000-0000-C000-000000000046}' : 'SyncObjects',
	'{00063083-0000-0000-C000-000000000046}' : '_SyncObject',
	'{000630C4-0000-0000-C000-000000000046}' : '_Accounts',
	'{000630C6-0000-0000-C000-000000000046}' : '_Stores',
	'{000630C8-0000-0000-C000-000000000046}' : '_SelectNamesDialog',
	'{0006302F-0000-0000-C000-000000000046}' : '_SharingItem',
	'{0006300A-0000-0000-C000-000000000046}' : '_Explorers',
	'{00063008-0000-0000-C000-000000000046}' : '_Inspectors',
	'{0006300B-0000-0000-C000-000000000046}' : 'Search',
	'{0006300C-0000-0000-C000-000000000046}' : '_Results',
	'{000630B1-0000-0000-C000-000000000046}' : '_Reminders',
	'{000630B0-0000-0000-C000-000000000046}' : '_Reminder',
	'{000630FC-0000-0000-C000-000000000046}' : '_TimeZones',
	'{00067367-0000-0000-C000-000000000046}' : '_OlkTimeZoneControl',
	'{00063080-0000-0000-C000-000000000046}' : 'PropertyPages',
	'{00063044-0000-0000-C000-000000000046}' : 'RecurrencePattern',
	'{0006304C-0000-0000-C000-000000000046}' : 'Exceptions',
	'{0006304D-0000-0000-C000-000000000046}' : 'Exception',
	'{00063033-0000-0000-C000-000000000046}' : '_AppointmentItem',
	'{00063062-0000-0000-C000-000000000046}' : '_MeetingItem',
	'{00063073-0000-0000-C000-000000000046}' : 'OutlookBarGroup',
	'{00063074-0000-0000-C000-000000000046}' : '_OutlookBarShortcuts',
	'{00063075-0000-0000-C000-000000000046}' : 'OutlookBarShortcut',
	'{00063072-0000-0000-C000-000000000046}' : '_OutlookBarGroups',
	'{00063070-0000-0000-C000-000000000046}' : '_OutlookBarPane',
	'{00063071-0000-0000-C000-000000000046}' : 'OutlookBarStorage',
	'{0006307F-0000-0000-C000-000000000046}' : 'PropertyPageSite',
	'{0006303F-0000-0000-C000-000000000046}' : 'Pages',
	'{00063020-0000-0000-C000-000000000046}' : '_DocumentItem',
	'{00063025-0000-0000-C000-000000000046}' : '_NoteItem',
	'{000630A0-0000-0000-C000-000000000046}' : '_ViewField',
	'{0006309E-0000-0000-C000-000000000046}' : '_ColumnFormat',
	'{000630A1-0000-0000-C000-000000000046}' : '_ViewFields',
	'{00063097-0000-0000-C000-000000000046}' : '_IconView',
	'{0006309A-0000-0000-C000-000000000046}' : '_OrderFields',
	'{0006309B-0000-0000-C000-000000000046}' : '_OrderField',
	'{00063098-0000-0000-C000-000000000046}' : '_CardView',
	'{0006309D-0000-0000-C000-000000000046}' : '_ViewFont',
	'{00063094-0000-0000-C000-000000000046}' : '_AutoFormatRules',
	'{00063093-0000-0000-C000-000000000046}' : '_AutoFormatRule',
	'{0006309C-0000-0000-C000-000000000046}' : '_TimelineView',
	'{000630E9-0000-0000-C000-000000000046}' : '_MailModule',
	'{000630EF-0000-0000-C000-000000000046}' : '_NavigationGroups',
	'{000630F0-0000-0000-C000-000000000046}' : '_NavigationGroup',
	'{000630F1-0000-0000-C000-000000000046}' : '_NavigationFolders',
	'{000630F2-0000-0000-C000-000000000046}' : '_NavigationFolder',
	'{000630EA-0000-0000-C000-000000000046}' : '_CalendarModule',
	'{000630EB-0000-0000-C000-000000000046}' : '_ContactsModule',
	'{000630EC-0000-0000-C000-000000000046}' : '_TasksModule',
	'{000630ED-0000-0000-C000-000000000046}' : '_JournalModule',
	'{000630EE-0000-0000-C000-000000000046}' : '_NotesModule',
	'{000630A2-0000-0000-C000-000000000046}' : '_BusinessCardView',
	'{00063059-0000-0000-C000-000000000046}' : '_FormRegionStartup',
	'{0006305A-0000-0000-C000-000000000046}' : '_FormRegion',
	'{000630FF-0000-0000-C000-000000000046}' : '_SolutionsModule',
	'{00063099-0000-0000-C000-000000000046}' : '_CalendarView',
	'{00063096-0000-0000-C000-000000000046}' : '_TableView',
	'{000630FE-0000-0000-C000-000000000046}' : '_MobileItem',
	'{00063022-0000-0000-C000-000000000046}' : '_JournalItem',
	'{00063024-0000-0000-C000-000000000046}' : '_PostItem',
	'{00063035-0000-0000-C000-000000000046}' : '_TaskItem',
	'{00063081-0000-0000-C000-000000000046}' : '_DistListItem',
	'{00063026-0000-0000-C000-000000000046}' : '_ReportItem',
	'{00063023-0000-0000-C000-000000000046}' : '_RemoteItem',
	'{00063036-0000-0000-C000-000000000046}' : '_TaskRequestItem',
	'{00063038-0000-0000-C000-000000000046}' : '_TaskRequestAcceptItem',
	'{00063039-0000-0000-C000-000000000046}' : '_TaskRequestDeclineItem',
	'{00063037-0000-0000-C000-000000000046}' : '_TaskRequestUpdateItem',
	'{00063107-0000-0000-C000-000000000046}' : '_ConversationHeader',
	'{000630A3-0000-0000-C000-000000000046}' : '_PeopleView',
	'{000630A4-0000-0000-C000-000000000046}' : '_ThreadView',
	'{000630A6-0000-0000-C000-000000000046}' : '_MessageListView',
	'{000630B3-0000-0000-C000-000000000046}' : '_SearchView',
}


NamesToIIDMap = {
	'_IRecipientControl' : '{D87E7E16-6897-11CE-A6C0-00AA00608FAA}',
	'_DRecipientControl' : '{0006F025-0000-0000-C000-000000000046}',
	'_DRecipientControlEvents' : '{D87E7E17-6897-11CE-A6C0-00AA00608FAA}',
	'_IDocSiteControl' : '{43507DD0-811D-11CE-B565-00AA00608FAA}',
	'_DDocSiteControl' : '{0006F026-0000-0000-C000-000000000046}',
	'_DDocSiteControlEvents' : '{50BB9B50-811D-11CE-B565-00AA00608FAA}',
	'OlkControl' : '{00067366-0000-0000-C000-000000000046}',
	'_OlkTextBox' : '{000672DA-0000-0000-C000-000000000046}',
	'OlkTextBoxEvents' : '{000672E6-0000-0000-C000-000000000046}',
	'_OlkLabel' : '{000672D9-0000-0000-C000-000000000046}',
	'OlkLabelEvents' : '{000672E5-0000-0000-C000-000000000046}',
	'_OlkCommandButton' : '{000672DB-0000-0000-C000-000000000046}',
	'OlkCommandButtonEvents' : '{000672E0-0000-0000-C000-000000000046}',
	'_OlkCheckBox' : '{000672DD-0000-0000-C000-000000000046}',
	'OlkCheckBoxEvents' : '{000672E2-0000-0000-C000-000000000046}',
	'_OlkOptionButton' : '{000672DC-0000-0000-C000-000000000046}',
	'OlkOptionButtonEvents' : '{000672E1-0000-0000-C000-000000000046}',
	'_OlkComboBox' : '{000672DE-0000-0000-C000-000000000046}',
	'OlkComboBoxEvents' : '{000672E3-0000-0000-C000-000000000046}',
	'_OlkListBox' : '{000672DF-0000-0000-C000-000000000046}',
	'OlkListBoxEvents' : '{000672E4-0000-0000-C000-000000000046}',
	'_OlkInfoBar' : '{000672F6-0000-0000-C000-000000000046}',
	'OlkInfoBarEvents' : '{000672F7-0000-0000-C000-000000000046}',
	'_OlkContactPhoto' : '{000672EB-0000-0000-C000-000000000046}',
	'OlkContactPhotoEvents' : '{000672EC-0000-0000-C000-000000000046}',
	'_OlkBusinessCardControl' : '{000672ED-0000-0000-C000-000000000046}',
	'OlkBusinessCardControlEvents' : '{000672EE-0000-0000-C000-000000000046}',
	'_OlkPageControl' : '{000672F8-0000-0000-C000-000000000046}',
	'OlkPageControlEvents' : '{000672F9-0000-0000-C000-000000000046}',
	'_OlkDateControl' : '{000672FA-0000-0000-C000-000000000046}',
	'OlkDateControlEvents' : '{000672FB-0000-0000-C000-000000000046}',
	'_OlkTimeControl' : '{000672EF-0000-0000-C000-000000000046}',
	'OlkTimeControlEvents' : '{000672F0-0000-0000-C000-000000000046}',
	'_OlkCategory' : '{000672F4-0000-0000-C000-000000000046}',
	'OlkCategoryEvents' : '{000672F5-0000-0000-C000-000000000046}',
	'_OlkFrameHeader' : '{00067352-0000-0000-C000-000000000046}',
	'OlkFrameHeaderEvents' : '{00067353-0000-0000-C000-000000000046}',
	'_OlkSenderPhoto' : '{00067355-0000-0000-C000-000000000046}',
	'OlkSenderPhotoEvents' : '{00067356-0000-0000-C000-000000000046}',
	'_TimeZone' : '{000630FD-0000-0000-C000-000000000046}',
	'_Application' : '{00063001-0000-0000-C000-000000000046}',
	'_NameSpace' : '{00063002-0000-0000-C000-000000000046}',
	'Recipient' : '{00063045-0000-0000-C000-000000000046}',
	'AddressEntry' : '{0006304B-0000-0000-C000-000000000046}',
	'AddressEntries' : '{0006304A-0000-0000-C000-000000000046}',
	'_ContactItem' : '{00063021-0000-0000-C000-000000000046}',
	'Actions' : '{0006303E-0000-0000-C000-000000000046}',
	'Action' : '{00063043-0000-0000-C000-000000000046}',
	'Attachments' : '{0006303C-0000-0000-C000-000000000046}',
	'Attachment' : '{00063007-0000-0000-C000-000000000046}',
	'_PropertyAccessor' : '{0006302D-0000-0000-C000-000000000046}',
	'FormDescription' : '{00063046-0000-0000-C000-000000000046}',
	'_Inspector' : '{00063005-0000-0000-C000-000000000046}',
	'_AttachmentSelection' : '{000630F9-0000-0000-C000-000000000046}',
	'Selection' : '{00063087-0000-0000-C000-000000000046}',
	'UserProperties' : '{0006303D-0000-0000-C000-000000000046}',
	'UserProperty' : '{00063042-0000-0000-C000-000000000046}',
	'MAPIFolder' : '{00063006-0000-0000-C000-000000000046}',
	'_Folders' : '{00063040-0000-0000-C000-000000000046}',
	'_Items' : '{00063041-0000-0000-C000-000000000046}',
	'_Explorer' : '{00063003-0000-0000-C000-000000000046}',
	'Panes' : '{00063009-0000-0000-C000-000000000046}',
	'_NavigationPane' : '{000630E6-0000-0000-C000-000000000046}',
	'_NavigationModule' : '{000630E8-0000-0000-C000-000000000046}',
	'_NavigationModules' : '{000630E7-0000-0000-C000-000000000046}',
	'_AccountSelector' : '{00063103-0000-0000-C000-000000000046}',
	'_Account' : '{000630C5-0000-0000-C000-000000000046}',
	'_Store' : '{000630C7-0000-0000-C000-000000000046}',
	'_Rules' : '{000630CC-0000-0000-C000-000000000046}',
	'_Rule' : '{000630CD-0000-0000-C000-000000000046}',
	'_RuleActions' : '{000630CE-0000-0000-C000-000000000046}',
	'_RuleAction' : '{000630CF-0000-0000-C000-000000000046}',
	'_MoveOrCopyRuleAction' : '{000630D0-0000-0000-C000-000000000046}',
	'_SendRuleAction' : '{000630D1-0000-0000-C000-000000000046}',
	'Recipients' : '{0006303B-0000-0000-C000-000000000046}',
	'_AssignToCategoryRuleAction' : '{000630D4-0000-0000-C000-000000000046}',
	'_PlaySoundRuleAction' : '{000630D5-0000-0000-C000-000000000046}',
	'_MarkAsTaskRuleAction' : '{000630D6-0000-0000-C000-000000000046}',
	'_NewItemAlertRuleAction' : '{000630D7-0000-0000-C000-000000000046}',
	'_RuleConditions' : '{000630D8-0000-0000-C000-000000000046}',
	'_RuleCondition' : '{000630D9-0000-0000-C000-000000000046}',
	'_ImportanceRuleCondition' : '{000630DA-0000-0000-C000-000000000046}',
	'_AccountRuleCondition' : '{000630DB-0000-0000-C000-000000000046}',
	'_TextRuleCondition' : '{000630E0-0000-0000-C000-000000000046}',
	'_CategoryRuleCondition' : '{000630DC-0000-0000-C000-000000000046}',
	'_FormNameRuleCondition' : '{000630DD-0000-0000-C000-000000000046}',
	'_ToOrFromRuleCondition' : '{000630DE-0000-0000-C000-000000000046}',
	'_AddressRuleCondition' : '{000630FA-0000-0000-C000-000000000046}',
	'_SenderInAddressListRuleCondition' : '{000630DF-0000-0000-C000-000000000046}',
	'AddressList' : '{00063049-0000-0000-C000-000000000046}',
	'_FromRssFeedRuleCondition' : '{000630FB-0000-0000-C000-000000000046}',
	'_SensitivityRuleCondition' : '{00063108-0000-0000-C000-000000000046}',
	'_Categories' : '{000630E4-0000-0000-C000-000000000046}',
	'_Category' : '{000630E3-0000-0000-C000-000000000046}',
	'_PreviewPane' : '{00063063-0000-0000-C000-000000000046}',
	'View' : '{00063095-0000-0000-C000-000000000046}',
	'_Views' : '{0006308D-0000-0000-C000-000000000046}',
	'_StorageItem' : '{000630CB-0000-0000-C000-000000000046}',
	'_Table' : '{000630D2-0000-0000-C000-000000000046}',
	'_Row' : '{000630D3-0000-0000-C000-000000000046}',
	'_Columns' : '{000630E1-0000-0000-C000-000000000046}',
	'_Column' : '{000630E5-0000-0000-C000-000000000046}',
	'_CalendarSharing' : '{000630E2-0000-0000-C000-000000000046}',
	'_MailItem' : '{00063034-0000-0000-C000-000000000046}',
	'ItemEvents' : '{0006303A-0000-0000-C000-000000000046}',
	'ItemEvents_10' : '{0006302B-0000-0000-C000-000000000046}',
	'Links' : '{0006308A-0000-0000-C000-000000000046}',
	'Link' : '{00063089-0000-0000-C000-000000000046}',
	'ItemProperties' : '{000630A8-0000-0000-C000-000000000046}',
	'ItemProperty' : '{000630A7-0000-0000-C000-000000000046}',
	'Conflicts' : '{000630C2-0000-0000-C000-000000000046}',
	'Conflict' : '{000630C3-0000-0000-C000-000000000046}',
	'_Conversation' : '{00063101-0000-0000-C000-000000000046}',
	'_SimpleItems' : '{00063102-0000-0000-C000-000000000046}',
	'_UserDefinedProperties' : '{00063047-0000-0000-C000-000000000046}',
	'_UserDefinedProperty' : '{0006305C-0000-0000-C000-000000000046}',
	'_ExchangeUser' : '{000630C9-0000-0000-C000-000000000046}',
	'_ExchangeDistributionList' : '{000630CA-0000-0000-C000-000000000046}',
	'AddressLists' : '{00063048-0000-0000-C000-000000000046}',
	'SyncObjects' : '{00063086-0000-0000-C000-000000000046}',
	'_SyncObject' : '{00063083-0000-0000-C000-000000000046}',
	'SyncObjectEvents' : '{00063085-0000-0000-C000-000000000046}',
	'_Accounts' : '{000630C4-0000-0000-C000-000000000046}',
	'AccountsEvents' : '{00063105-0000-0000-C000-000000000046}',
	'_Stores' : '{000630C6-0000-0000-C000-000000000046}',
	'StoresEvents_12' : '{000630F8-0000-0000-C000-000000000046}',
	'_SelectNamesDialog' : '{000630C8-0000-0000-C000-000000000046}',
	'_SharingItem' : '{0006302F-0000-0000-C000-000000000046}',
	'_Explorers' : '{0006300A-0000-0000-C000-000000000046}',
	'ExplorerEvents' : '{0006304F-0000-0000-C000-000000000046}',
	'ExplorerEvents_10' : '{0006300F-0000-0000-C000-000000000046}',
	'_Inspectors' : '{00063008-0000-0000-C000-000000000046}',
	'InspectorEvents' : '{0006307D-0000-0000-C000-000000000046}',
	'InspectorEvents_10' : '{0006302A-0000-0000-C000-000000000046}',
	'Search' : '{0006300B-0000-0000-C000-000000000046}',
	'_Results' : '{0006300C-0000-0000-C000-000000000046}',
	'_Reminders' : '{000630B1-0000-0000-C000-000000000046}',
	'_Reminder' : '{000630B0-0000-0000-C000-000000000046}',
	'_TimeZones' : '{000630FC-0000-0000-C000-000000000046}',
	'_OlkTimeZoneControl' : '{00067367-0000-0000-C000-000000000046}',
	'OlkTimeZoneControlEvents' : '{00067368-0000-0000-C000-000000000046}',
	'ApplicationEvents' : '{0006304E-0000-0000-C000-000000000046}',
	'PropertyPages' : '{00063080-0000-0000-C000-000000000046}',
	'RecurrencePattern' : '{00063044-0000-0000-C000-000000000046}',
	'Exceptions' : '{0006304C-0000-0000-C000-000000000046}',
	'Exception' : '{0006304D-0000-0000-C000-000000000046}',
	'_AppointmentItem' : '{00063033-0000-0000-C000-000000000046}',
	'_MeetingItem' : '{00063062-0000-0000-C000-000000000046}',
	'ExplorersEvents' : '{00063078-0000-0000-C000-000000000046}',
	'FoldersEvents' : '{00063076-0000-0000-C000-000000000046}',
	'InspectorsEvents' : '{00063079-0000-0000-C000-000000000046}',
	'ItemsEvents' : '{00063077-0000-0000-C000-000000000046}',
	'NameSpaceEvents' : '{0006308C-0000-0000-C000-000000000046}',
	'OutlookBarGroup' : '{00063073-0000-0000-C000-000000000046}',
	'_OutlookBarShortcuts' : '{00063074-0000-0000-C000-000000000046}',
	'OutlookBarShortcut' : '{00063075-0000-0000-C000-000000000046}',
	'_OutlookBarGroups' : '{00063072-0000-0000-C000-000000000046}',
	'OutlookBarGroupsEvents' : '{0006307B-0000-0000-C000-000000000046}',
	'_OutlookBarPane' : '{00063070-0000-0000-C000-000000000046}',
	'OutlookBarStorage' : '{00063071-0000-0000-C000-000000000046}',
	'OutlookBarPaneEvents' : '{0006307A-0000-0000-C000-000000000046}',
	'OutlookBarShortcutsEvents' : '{0006307C-0000-0000-C000-000000000046}',
	'PropertyPage' : '{0006307E-0000-0000-C000-000000000046}',
	'PropertyPageSite' : '{0006307F-0000-0000-C000-000000000046}',
	'Pages' : '{0006303F-0000-0000-C000-000000000046}',
	'ApplicationEvents_10' : '{0006300E-0000-0000-C000-000000000046}',
	'ApplicationEvents_11' : '{0006302C-0000-0000-C000-000000000046}',
	'MAPIFolderEvents_12' : '{000630F7-0000-0000-C000-000000000046}',
	'ResultsEvents' : '{0006300D-0000-0000-C000-000000000046}',
	'_ViewsEvents' : '{000630A5-0000-0000-C000-000000000046}',
	'ReminderCollectionEvents' : '{000630B2-0000-0000-C000-000000000046}',
	'_DocumentItem' : '{00063020-0000-0000-C000-000000000046}',
	'_NoteItem' : '{00063025-0000-0000-C000-000000000046}',
	'FormRegionEvents' : '{0006305B-0000-0000-C000-000000000046}',
	'_ViewField' : '{000630A0-0000-0000-C000-000000000046}',
	'_ColumnFormat' : '{0006309E-0000-0000-C000-000000000046}',
	'_ViewFields' : '{000630A1-0000-0000-C000-000000000046}',
	'_IconView' : '{00063097-0000-0000-C000-000000000046}',
	'_OrderFields' : '{0006309A-0000-0000-C000-000000000046}',
	'_OrderField' : '{0006309B-0000-0000-C000-000000000046}',
	'_CardView' : '{00063098-0000-0000-C000-000000000046}',
	'_ViewFont' : '{0006309D-0000-0000-C000-000000000046}',
	'_AutoFormatRules' : '{00063094-0000-0000-C000-000000000046}',
	'_AutoFormatRule' : '{00063093-0000-0000-C000-000000000046}',
	'_TimelineView' : '{0006309C-0000-0000-C000-000000000046}',
	'_MailModule' : '{000630E9-0000-0000-C000-000000000046}',
	'_NavigationGroups' : '{000630EF-0000-0000-C000-000000000046}',
	'_NavigationGroup' : '{000630F0-0000-0000-C000-000000000046}',
	'_NavigationFolders' : '{000630F1-0000-0000-C000-000000000046}',
	'_NavigationFolder' : '{000630F2-0000-0000-C000-000000000046}',
	'_CalendarModule' : '{000630EA-0000-0000-C000-000000000046}',
	'_ContactsModule' : '{000630EB-0000-0000-C000-000000000046}',
	'_TasksModule' : '{000630EC-0000-0000-C000-000000000046}',
	'_JournalModule' : '{000630ED-0000-0000-C000-000000000046}',
	'_NotesModule' : '{000630EE-0000-0000-C000-000000000046}',
	'NavigationPaneEvents_12' : '{000630F3-0000-0000-C000-000000000046}',
	'NavigationGroupsEvents_12' : '{000630F4-0000-0000-C000-000000000046}',
	'_BusinessCardView' : '{000630A2-0000-0000-C000-000000000046}',
	'_FormRegionStartup' : '{00063059-0000-0000-C000-000000000046}',
	'_FormRegion' : '{0006305A-0000-0000-C000-000000000046}',
	'_SolutionsModule' : '{000630FF-0000-0000-C000-000000000046}',
	'_CalendarView' : '{00063099-0000-0000-C000-000000000046}',
	'_TableView' : '{00063096-0000-0000-C000-000000000046}',
	'_MobileItem' : '{000630FE-0000-0000-C000-000000000046}',
	'_JournalItem' : '{00063022-0000-0000-C000-000000000046}',
	'_PostItem' : '{00063024-0000-0000-C000-000000000046}',
	'_TaskItem' : '{00063035-0000-0000-C000-000000000046}',
	'AccountSelectorEvents' : '{00063104-0000-0000-C000-000000000046}',
	'_DistListItem' : '{00063081-0000-0000-C000-000000000046}',
	'_ReportItem' : '{00063026-0000-0000-C000-000000000046}',
	'_RemoteItem' : '{00063023-0000-0000-C000-000000000046}',
	'_TaskRequestItem' : '{00063036-0000-0000-C000-000000000046}',
	'_TaskRequestAcceptItem' : '{00063038-0000-0000-C000-000000000046}',
	'_TaskRequestDeclineItem' : '{00063039-0000-0000-C000-000000000046}',
	'_TaskRequestUpdateItem' : '{00063037-0000-0000-C000-000000000046}',
	'_ConversationHeader' : '{00063107-0000-0000-C000-000000000046}',
	'_PeopleView' : '{000630A3-0000-0000-C000-000000000046}',
	'_ThreadView' : '{000630A4-0000-0000-C000-000000000046}',
	'_MessageListView' : '{000630A6-0000-0000-C000-000000000046}',
	'_SearchView' : '{000630B3-0000-0000-C000-000000000046}',
}

win32com.client.constants.__dicts__.append(constants.__dict__)

