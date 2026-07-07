# Android Vibration Sensor Demo MVP

## Goal

Build a small demo where an Android phone acts as a vibration sensor.

The user can shake the phone or tap the screen. The Android app sends sensor samples to Cloud Run. Grafana Cloud reads the Cloud Run JSON API through the existing Infinity datasource and shows a near real-time dashboard.

## Architecture

```text
Android app
  -> POST /api/mobile-sensor
  -> Cloud Run receiver
  -> In-memory recent samples
  -> AI failure-risk analysis
  -> Grafana Cloud Infinity datasource
  -> Android Vibration Sensor Demo dashboard
```

This MVP avoids a new time-series database. It is intended for sales demos and short PoC sessions.

## Components

### Android app

Path:

```text
mobile/android-vibration-demo
```

Features:

- Accelerometer X, Y, Z
- Acceleration magnitude
- Tap shock event
- Battery percent
- Device ID
- Start / Stop streaming
- Send interval: 100 ms, 500 ms, 1000 ms
- Editable API URL

The app uses ASCII-only Java code and ASCII-only UI strings.

### Cloud Run API

Endpoints:

```text
POST /api/mobile-sensor
GET  /api/mobile-sensor/history
GET  /api/mobile-sensor/latest
GET  /api/mobile-sensor/metrics
GET  /api/ai/failure-risk
POST /api/ai/failure-risk
```

`/api/mobile-sensor/history` returns recent samples for Grafana Infinity.

`/api/mobile-sensor/latest` returns the latest row per device.

`/api/mobile-sensor/metrics` exposes a Prometheus text view for debugging or future scraping.

`/api/ai/failure-risk` calculates a maintenance risk score from recent sensor samples. It uses rule-based checks for vibration, shock events, stale communication, and battery level. When Vertex AI or OpenAI is configured, it also generates Japanese maintenance comments for Grafana and the browser UI. AI comments are cached for a short period to avoid calling the model on every Grafana refresh.

### Grafana dashboard

Path:

```text
dashboards/android-vibration-sensor-dashboard.json
```

Datasource:

```text
grafanacloud-infinity
```

Dashboard UID:

```text
android-vibration-sensor-demo
```

Panels:

- Latest Vibration
- Battery
- Tap Count
- Vibration Trend
- Acceleration XYZ
- Shock Events
- AI Maintenance Insight
- AI App Log Analysis
- Device Communication Status

## Sample payload

```json
{
  "deviceId": "android-demo-001",
  "timestamp": "2026-06-29T10:00:00Z",
  "accelX": 0.12,
  "accelY": -0.03,
  "accelZ": 9.81,
  "accelMagnitude": 9.82,
  "shock": false,
  "tapCount": 0,
  "batteryPercent": 83,
  "status": "ONLINE"
}
```

## Setup

Deploy the Cloud Run app first. Then create the Grafana dashboard.

```powershell
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
$env:GRAFANA_SERVICE_ACCOUNT_TOKEN=[Environment]::GetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN","User")
$env:MOBILE_SENSOR_API_BASE_URL="https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app"
node scripts/setup-android-vibration-dashboard.js
```

## Android build

Open this folder in Android Studio:

```text
mobile/android-vibration-demo
```

Build and run on an Android phone.

Command line build example:

```powershell
$env:ANDROID_HOME="C:\Users\tsuts\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT="C:\Users\tsuts\AppData\Local\Android\Sdk"
C:\Users\tsuts\AndroidStudioProjects\helloworld\gradlew.bat `
  -p "C:\Users\tsuts\OneDrive\...\Grafana\mobile\android-vibration-demo" `
  assembleDebug
```

Debug APK output:

```text
mobile/android-vibration-demo/app/build/outputs/apk/debug/app-debug.apk
```

Default API URL:

```text
https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app/api/mobile-sensor
```

## Demo flow

1. Open the Grafana dashboard.
2. Start the Android app.
3. Press Start.
4. Keep the phone still and show a stable signal.
5. Shake the phone and show the vibration trend.
6. Tap the screen and show shock events.
7. Show the AI Maintenance Insight panel.
8. Show the AI App Log Analysis panel.
9. Use the browser UI AI故障診断デモ and AIログ解析デモ buttons to preview the same summaries.
10. Press Stop.

## AI failure-risk example

Request:

```powershell
$base="https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app"
Invoke-RestMethod "$base/api/ai/failure-risk?deviceId=android-demo-001&windowMinutes=10"
```

Response fields:

```text
riskLevel
riskScore
summary
possibleCause
recommendedAction
aiProvider
sampleCount
maxMagnitude
shockCount
```

The diagnosis is for demo and maintenance assistance. It does not confirm an actual failure by itself.

## MVP limits

- Data is stored in Cloud Run memory only.
- Data can be lost when Cloud Run restarts.
- The dashboard is for a live sales demo, not long-term storage.
- The AI diagnosis is an assistance feature based on simple statistics and generated comments.
- For production, replace memory storage with Grafana Cloud Metrics, InfluxDB, BigQuery, or another time-series store.
