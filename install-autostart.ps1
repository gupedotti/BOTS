# Registra o vigia do Gubots no Agendador de Tarefas do Windows (usuário atual, sem admin):
# sobe no login e é conferido a cada 5 min (se o vigia tiver morrido, o Agendador o religa; se estiver vivo,
# a nova cópia sai sozinha). Rodando pelo Agendador, nada fica preso ao processo que o instalou.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$dir\watchdog.vbs`"" -WorkingDirectory $dir
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Gubots' -Action $action -Trigger $logon, $every -Settings $settings -Principal $principal -Description 'Vigia do Gubots: religa servidor e túnel Cloudflare' -Force | Out-Null
# o atalho antigo da pasta Inicializar fica redundante
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Gubots.vbs" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'Gubots'
'ok'
