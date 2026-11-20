' Omyrava Studio - masaustu kisayolunun calistirdigi baslatici.
' Panel zaten calisiyorsa tarayicida acar. Calismiyorsa BASLAT.bat'i kucultulmus pencerede
' baslatir, panel hazir olunca (en fazla 3 dk) tarayicida acar.
Option Explicit
Dim sh, fso, dir, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:3000"

Function Hazir()
  Dim x
  Hazir = False
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1500, 1500, 1500, 3000
  x.open "GET", url & "/api/health", False
  x.send
  If Err.Number = 0 Then
    If x.status = 200 Then Hazir = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

If Not Hazir() Then
  sh.CurrentDirectory = dir
  ' 7 = kucultulmus pencere (gorev cubugunda kalir; kapatinca panel durur)
  sh.Run "cmd /c """"" & dir & "\BASLAT.bat"" --sessiz""", 7, False
  For i = 1 To 180
    WScript.Sleep 1000
    If Hazir() Then Exit For
  Next
End If
sh.Run url
