' Vigia do Gubots: roda escondido (wscript, sem janela) desde o login do Windows.
' A cada 20 s:
'   1. servidor local (http://127.0.0.1:8787): 2 falhas seguidas -> mata o node travado e sobe de novo
'   2. tunel Cloudflare (opcional, so com data\cloudflared\config.yml): se o cloudflared do Gubots nao estiver rodando, sobe;
'      se o endereco publico falhar 3 vezes seguidas com o servidor local ok, reinicia o cloudflared
' A credencial do tunel fica em data\cloudflared\ (fora do git). Log em data\watchdog.log. Uma copia por vez.
Option Explicit
Dim sh, fso, dir, wmi, LOCAL_URL, PUBLIC_URL, CF_EXE, CF_CONFIG, failLocal, failPublic, graceUntil

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
LOCAL_URL = "http://127.0.0.1:8787/manifest.webmanifest"
PUBLIC_URL = "https://SEU-DOMINIO/manifest.webmanifest" ' troque se usar tunel
CF_EXE = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
CF_CONFIG = dir & "\data\cloudflared\config.yml"

If Count("Name='wscript.exe' AND CommandLine LIKE '%watchdog.vbs%'") > 1 Then WScript.Quit

failLocal = 0: failPublic = 0: graceUntil = 0
Log "vigia iniciado"
Do
  If Timer >= graceUntil Or graceUntil - Timer > 120 Then
    If Ok(LOCAL_URL) Then
      failLocal = 0
      CheckTunnel
    Else
      failLocal = failLocal + 1
      If failLocal >= 2 Then RestartServer
    End If
  End If
  WScript.Sleep 20000
Loop

Sub RestartServer
  Dim p
  Log "servidor sem resposta: reiniciando"
  For Each p In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%server_index.ts%'")
    p.Terminate
  Next
  WScript.Sleep 2000
  sh.Run "cmd /c node --no-warnings server\index.ts >> data\server.log 2>&1", 0, False
  failLocal = 0: failPublic = 0
  graceUntil = Timer + 40 ' da tempo de subir antes de checar de novo
End Sub

Sub CheckTunnel
  If Not fso.FileExists(CF_EXE) Or Not fso.FileExists(CF_CONFIG) Then Exit Sub
  If Count("Name='cloudflared.exe' AND CommandLine LIKE '%Gubots_data_cloudflared%'") = 0 Then
    Log "tunel Cloudflare parado: subindo"
    StartTunnel
    Exit Sub
  End If
  If Ok(PUBLIC_URL) Then
    failPublic = 0
  Else
    failPublic = failPublic + 1
    If failPublic >= 3 Then
      Log "endereco publico fora com servidor ok: reiniciando cloudflared"
      KillTunnel
      WScript.Sleep 2000
      StartTunnel
    End If
  End If
End Sub

Sub StartTunnel
  Dim q: q = Chr(34)
  sh.Run "cmd /c " & q & q & CF_EXE & q & " tunnel --no-autoupdate --protocol http2 --config " & q & CF_CONFIG & q & " run >> " & q & dir & "\data\cloudflared\tunnel.log" & q & " 2>&1" & q, 0, False
  failPublic = 0
  graceUntil = Timer + 40
End Sub

Sub KillTunnel
  Dim p
  For Each p In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='cloudflared.exe' AND CommandLine LIKE '%Gubots_data_cloudflared%'")
    p.Terminate
  Next
End Sub

Function Ok(url)
  Dim h
  Ok = False
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 5000, 5000, 8000, 8000
  h.open "GET", url & "?wd=" & CLng(Timer), False
  h.send
  If Err.Number = 0 Then Ok = (h.status = 200)
  On Error GoTo 0
End Function

Function Count(where)
  Count = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE " & where).Count
End Function

Sub Log(msg)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(dir & "\data\watchdog.log", 8, True)
  f.WriteLine Now & "  " & msg
  f.Close
End Sub
