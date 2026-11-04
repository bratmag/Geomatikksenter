param(
  [string]$AccessRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\Trimble Access')
)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  New-Item -ItemType Directory -Path '.local-gemini-test' -Force | Out-Null
  $transform = [Xml.Xsl.XslCompiledTransform]::new()
  $transform.Load((Join-Path $AccessRoot 'JobXML zigzag.xsl'))
  $support = Join-Path (Split-Path (Resolve-Path $AccessRoot) -Parent) 'Support\Kaare Mortensen AS'
  $transform.Transform((Join-Path $support 'SV__Gemini,_segmenterte_linjer\asfalt start 202611.jxl'), (Join-Path $PWD '.local-gemini-test\original-expected.jxl'))
  $transform.Transform((Join-Path $support 'zigzag diagnose.jxl'), (Join-Path $PWD '.local-gemini-test\diagnose-expected.jxl'))
  node tests/gemini-jxl.test.cjs $AccessRoot
  if ($LASTEXITCODE -ne 0) { throw 'Gemini tests failed.' }
} finally { Pop-Location }
