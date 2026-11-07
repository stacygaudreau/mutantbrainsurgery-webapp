' ============================================================================
' ASP oracle harness: runs the ORIGINAL Mutant Brain Surgery VBScript under
' Windows Script Host with minimal mocks of the ASP intrinsic objects.
'
' Usage: cscript //nologo harness.vbs <jobs-file>
'
' Jobs file (one directive per line, all strings hex-encoded as UTF-16 code
' units < 256, i.e. latin1):
'   DEFS <path>                 ExecuteGlobal a definitions file (once)
'   PAGE <name> <path>          register page body code under <name>
'   JOB <name> <out-path>       start a new request for page <name>
'   F <hexkey> <hexvalue>       Request.Form(key) = value
'   Q <hexkey> <hexvalue>       Request.QueryString(key) = value
'   B <hexbytes>                raw request body (for Request.BinaryRead)
'   RUN                         execute the job, write output file
'
' Output file per job: "T <len>" + CRLF + <len raw chars> (Response.Write) / "B <hex>"
' (Response.BinaryWrite) / "H <hexname> <hexvalue>" (AddHeader), and a final
' "OK" or "ERR <number> <hexdescription>" (runtime error => what ASP would
' have turned into an HTTP 500).
' NOTE: deliberately no Option Explicit: the original code relies on
' implicitly declared variables, exactly as it did under IIS.
' ============================================================================

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

Function HexToStr(h)
	Dim i, s : s = ""
	For i = 1 To Len(h) Step 2
		s = s & Chr(CLng("&H" & Mid(h, i, 2)))
	Next
	HexToStr = s
End Function

Function HexToBytes(h)
	Dim i, s : s = ""
	For i = 1 To Len(h) Step 2
		s = s & ChrB(CLng("&H" & Mid(h, i, 2)))
	Next
	HexToBytes = s
End Function

Function StrToHex(s)
	Dim i, c, parts()
	If Len(s) = 0 Then StrToHex = "" : Exit Function
	ReDim parts(Len(s) - 1)
	For i = 1 To Len(s)
		c = AscW(Mid(s, i, 1))
		If c < 0 Then c = c + 65536
		If c > 255 Then c = 63 ' "?" (never expected: page output is ASCII)
		parts(i - 1) = Right("0" & Hex(c), 2)
	Next
	StrToHex = Join(parts, "")
End Function

Function BytesToHex(b)
	Dim i, parts()
	If LenB(b) = 0 Then BytesToHex = "" : Exit Function
	ReDim parts(LenB(b) - 1)
	For i = 1 To LenB(b)
		parts(i - 1) = Right("0" & Hex(AscB(MidB(b, i, 1))), 2)
	Next
	BytesToHex = Join(parts, "")
End Function

' ---------------------------------------------------------------- mocks
Class MockRequest
	Public FormD, QueryD, Body
	Private Sub Class_Initialize
		Set FormD = CreateObject("Scripting.Dictionary")
		Set QueryD = CreateObject("Scripting.Dictionary")
		Body = ""
	End Sub
	' Real ASP returns Empty for a key that was not submitted (e.g. a disabled
	' <select>); CByte(Empty) = 0 and CLng(Empty) = 0. This matters!
	Public Function Form(k)
		If FormD.Exists(k) Then Form = FormD(k) Else Form = Empty
	End Function
	Public Function QueryString(k)
		If QueryD.Exists(k) Then QueryString = QueryD(k) Else QueryString = Empty
	End Function
	Public Property Get TotalBytes
		TotalBytes = LenB(Body)
	End Property
	Public Function BinaryRead(n)
		BinaryRead = Body
	End Function
End Class

Class MockResponse
	Private lines(), count
	Private Sub Class_Initialize
		count = 0
		ReDim lines(63)
	End Sub
	Private Sub Add(s)
		If count > UBound(lines) Then ReDim Preserve lines(UBound(lines) * 2 + 1)
		lines(count) = s
		count = count + 1
	End Sub
	Public Sub Write(s)
		' raw text with a length prefix (hex-encoding 250KB of HTML in VBScript is slow)
		Dim t : t = CStr(s)
		Add "T " & Len(t) & vbCrLf & t
	End Sub
	Public Sub BinaryWrite(b)
		Add "B " & BytesToHex(b)
	End Sub
	Public Sub AddHeader(n, v)
		Add "H " & StrToHex(CStr(n)) & " " & StrToHex(CStr(v))
	End Sub
	Public Function Dump()
		If count = 0 Then Dump = "" : Exit Function
		ReDim Preserve lines(count - 1)
		Dump = Join(lines, vbCrLf) & vbCrLf
	End Function
End Class

Class MockServer
	Public Function CreateObject(p)
		Set CreateObject = WScript.CreateObject(p)
	End Function
End Class

Dim Request, Response, Server
Set Server = New MockServer

' ---------------------------------------------------------------- driver
Function ReadAll(p)
	Dim ts : Set ts = fso.OpenTextFile(p, 1, False, 0)
	ReadAll = ts.ReadAll
	ts.Close
End Function

Dim pages : Set pages = CreateObject("Scripting.Dictionary")
Dim curPage, curOut

Sub RunJob()
	Dim errNum, errDesc, ts, dump
	On Error Resume Next
	ExecuteGlobal pages(curPage)
	errNum = Err.Number : errDesc = Err.Description
	Err.Clear
	On Error GoTo 0
	dump = Response.Dump()
	Set ts = fso.CreateTextFile(curOut, True, False)
	ts.Write dump
	If errNum <> 0 Then
		ts.WriteLine "ERR " & errNum & " " & StrToHex(errDesc)
	Else
		ts.WriteLine "OK"
	End If
	ts.Close
End Sub

Dim jobs, jobLine, parts
Set jobs = fso.OpenTextFile(WScript.Arguments(0), 1, False, 0)
Do While Not jobs.AtEndOfStream
	jobLine = jobs.ReadLine
	If Len(jobLine) > 0 Then
		parts = Split(jobLine, " ")
		Select Case parts(0)
			Case "DEFS"
				ExecuteGlobal ReadAll(Mid(jobLine, 6))
			Case "PAGE"
				pages(parts(1)) = ReadAll(Mid(jobLine, Len(parts(0)) + Len(parts(1)) + 3))
			Case "JOB"
				curPage = parts(1)
				curOut = Mid(jobLine, Len(parts(0)) + Len(parts(1)) + 3)
				Set Request = New MockRequest
				Set Response = New MockResponse
			Case "F"
				Request.FormD(HexToStr(parts(1))) = HexToStr(parts(2))
			Case "Q"
				Request.QueryD(HexToStr(parts(1))) = HexToStr(parts(2))
			Case "B"
				Request.Body = HexToBytes(parts(1))
			Case "RUN"
				RunJob
		End Select
	End If
Loop
jobs.Close
