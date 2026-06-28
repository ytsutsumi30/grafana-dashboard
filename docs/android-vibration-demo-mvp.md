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
```

`/api/mobile-sensor/history` returns recent samples for Grafana Infinity.

`/api/mobile-sensor/latest` returns the latest row per device.

`/api/mobile-sensor/metrics` exposes a Prometheus text view for debugging or future scraping.

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
7. Press Stop.

## MVP limits

- Data is stored in Cloud Run memory only.
- Data can be lost when Cloud Run restarts.
- The dashboard is for a live sales demo, not long-term storage.
- For production, replace memory storage with Grafana Cloud Metrics, InfluxDB, BigQuery, or another time-series store.
