$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$synthesizer = $null
$audioStream = $null
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName System.Speech
  $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $available = @($synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled })
  if ($request.action -eq 'voices') {
    $voices = @($available | ForEach-Object { @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name; gender = $_.VoiceInfo.Gender.ToString() } })
    [Console]::Out.Write((@{ voices = $voices } | ConvertTo-Json -Depth 4 -Compress))
  } else {
    $spokenText = [string]$request.text
    if ([string]::IsNullOrWhiteSpace($spokenText) -or $spokenText.Length -gt 6000) { throw 'INVALID_TEXT' }
    if ($request.voice) {
      $synthesizer.SelectVoice([string]$request.voice)
    } elseif ($spokenText -match '[\u3400-\u9fff]') {
      $chinese = $available | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
      if ($null -eq $chinese) { throw 'NO_CHINESE_VOICE' }
      $synthesizer.SelectVoice($chinese.VoiceInfo.Name)
    }
    $audioStream = New-Object System.IO.MemoryStream
    $synthesizer.SetOutputToWaveStream($audioStream)
    $synthesizer.Speak($spokenText)
    $synthesizer.SetOutputToNull()
    [Console]::Out.Write((@{ audio = [Convert]::ToBase64String($audioStream.ToArray()); voice = $synthesizer.Voice.Name } | ConvertTo-Json -Compress))
  }
} catch {
  $failureCode = if ($_.Exception.Message -eq 'NO_CHINESE_VOICE') { 'NO_CHINESE_VOICE' } else { 'SYSTEM_TTS_FAILED' }
  [Console]::Out.Write((@{ error = 'Windows speech unavailable'; code = $failureCode } | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($null -ne $synthesizer) { $synthesizer.Dispose() }
  if ($null -ne $audioStream) { $audioStream.Dispose() }
}
