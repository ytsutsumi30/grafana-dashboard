package com.example.androidvibrationdemo;

import android.app.Activity;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity implements SensorEventListener {
    private static final String DEFAULT_API_URL = "https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app/api/mobile-sensor";

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private ScheduledExecutorService executor;
    private ScheduledFuture<?> senderTask;

    private EditText apiUrlInput;
    private EditText deviceIdInput;
    private Spinner intervalSpinner;
    private Button startButton;
    private Button stopButton;
    private Button shockButton;
    private TextView statusText;
    private TextView sensorText;

    private volatile float accelX;
    private volatile float accelY;
    private volatile float accelZ;
    private volatile boolean shockPending;
    private volatile int tapCount;
    private volatile boolean running;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        executor = Executors.newSingleThreadScheduledExecutor();
        setContentView(buildLayout());
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 32, 32, 32);
        root.setGravity(Gravity.TOP);

        TextView title = new TextView(this);
        title.setText("Android Vibration Demo");
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(title, fullWidth());

        apiUrlInput = new EditText(this);
        apiUrlInput.setHint("API URL");
        apiUrlInput.setSingleLine(true);
        apiUrlInput.setText(DEFAULT_API_URL);
        root.addView(label("API URL"));
        root.addView(apiUrlInput, fullWidth());

        deviceIdInput = new EditText(this);
        deviceIdInput.setHint("Device ID");
        deviceIdInput.setSingleLine(true);
        deviceIdInput.setText(defaultDeviceId());
        root.addView(label("Device ID"));
        root.addView(deviceIdInput, fullWidth());

        intervalSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new String[]{"100 ms", "500 ms", "1000 ms"});
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        intervalSpinner.setAdapter(adapter);
        intervalSpinner.setSelection(1);
        root.addView(label("Send Interval"));
        root.addView(intervalSpinner, fullWidth());

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        startButton = new Button(this);
        startButton.setText("Start");
        stopButton = new Button(this);
        stopButton.setText("Stop");
        stopButton.setEnabled(false);
        buttons.addView(startButton, weightOne());
        buttons.addView(stopButton, weightOne());
        root.addView(buttons, fullWidth());

        shockButton = new Button(this);
        shockButton.setText("Tap Shock");
        root.addView(shockButton, fullWidth());

        sensorText = new TextView(this);
        sensorText.setTextSize(18);
        sensorText.setText("Accel: waiting");
        root.addView(sensorText, fullWidth());

        statusText = new TextView(this);
        statusText.setText("Status: idle");
        root.addView(statusText, fullWidth());

        startButton.setOnClickListener(view -> startSending());
        stopButton.setOnClickListener(view -> stopSending());
        shockButton.setOnClickListener(view -> markShock());
        root.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                markShock();
            }
            return true;
        });

        return root;
    }

    private TextView label(String text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(14);
        return label;
    }

    private LinearLayout.LayoutParams fullWidth() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 12, 0, 12);
        return params;
    }

    private LinearLayout.LayoutParams weightOne() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(4, 12, 4, 12);
        return params;
    }

    private String defaultDeviceId() {
        String id = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        if (id == null || id.length() < 4) {
            return "android-demo-001";
        }
        return "android-" + id.substring(Math.max(0, id.length() - 6));
    }

    private int selectedIntervalMs() {
        String value = String.valueOf(intervalSpinner.getSelectedItem());
        if (value.startsWith("100 ")) return 100;
        if (value.startsWith("1000 ")) return 1000;
        return 500;
    }

    private void startSending() {
        if (running) return;
        running = true;
        startButton.setEnabled(false);
        stopButton.setEnabled(true);
        intervalSpinner.setEnabled(false);
        sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        int intervalMs = selectedIntervalMs();
        senderTask = executor.scheduleAtFixedRate(this::sendCurrentSample, 0, intervalMs, TimeUnit.MILLISECONDS);
        setStatus("Status: streaming");
    }

    private void stopSending() {
        running = false;
        if (senderTask != null) {
            senderTask.cancel(false);
            senderTask = null;
        }
        sensorManager.unregisterListener(this);
        startButton.setEnabled(true);
        stopButton.setEnabled(false);
        intervalSpinner.setEnabled(true);
        setStatus("Status: stopped");
    }

    private void markShock() {
        shockPending = true;
        tapCount += 1;
        setStatus("Status: shock marked");
    }

    private void sendCurrentSample() {
        try {
            String apiUrl = apiUrlInput.getText().toString().trim();
            String deviceId = deviceIdInput.getText().toString().trim();
            if (apiUrl.isEmpty() || deviceId.isEmpty()) {
                setStatus("Status: API URL and Device ID required");
                return;
            }

            float x = accelX;
            float y = accelY;
            float z = accelZ;
            double magnitude = Math.sqrt(x * x + y * y + z * z);
            boolean shock = shockPending || magnitude > 14.0;
            shockPending = false;

            JSONObject payload = new JSONObject();
            payload.put("deviceId", deviceId);
            payload.put("timestamp", Instant.now().toString());
            payload.put("accelX", x);
            payload.put("accelY", y);
            payload.put("accelZ", z);
            payload.put("accelMagnitude", magnitude);
            payload.put("shock", shock);
            payload.put("tapCount", tapCount);
            payload.put("batteryPercent", batteryPercent());
            payload.put("status", "ONLINE");

            postJson(apiUrl, payload.toString());
            setStatus("Status: sent " + Instant.now().toString());
        } catch (Exception error) {
            setStatus("Status: send failed " + error.getClass().getSimpleName());
        }
    }

    private void postJson(String apiUrl, String json) throws Exception {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        try (OutputStream stream = connection.getOutputStream()) {
            stream.write(bytes);
        }
        int code = connection.getResponseCode();
        connection.disconnect();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("HTTP " + code);
        }
    }

    private int batteryPercent() {
        BatteryManager manager = (BatteryManager) getSystemService(BATTERY_SERVICE);
        if (manager == null) return 100;
        int value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return value >= 0 ? value : 100;
    }

    private void setStatus(String text) {
        runOnUiThread(() -> statusText.setText(text));
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        accelX = event.values[0];
        accelY = event.values[1];
        accelZ = event.values[2];
        double magnitude = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
        String text = String.format(Locale.US, "X %.2f  Y %.2f  Z %.2f  Mag %.2f", accelX, accelY, accelZ, magnitude);
        runOnUiThread(() -> sensorText.setText(text));
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    @Override
    protected void onDestroy() {
        stopSending();
        executor.shutdownNow();
        super.onDestroy();
    }
}
