package com.example.androidvibrationdemo;

import android.app.Activity;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.provider.Settings;
import android.content.SharedPreferences;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

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
    private static final String DEFAULT_GOOGLE_WEB_CLIENT_ID = "577010681495-96mkdue8g1ufrc9mag8sqmrsmkvgpur4.apps.googleusercontent.com";
    private static final int GOOGLE_SIGN_IN_REQUEST = 9001;
    private static final int OFFLINE_QUEUE_CAPACITY = 1000;
    private static final long MAX_RETRY_DELAY_MS = 60000L;

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private ScheduledExecutorService executor;
    private ScheduledFuture<?> senderTask;
    private SensorWindowAggregator sensorAggregator;
    private PersistentPayloadQueue pendingPayloads;

    private EditText apiUrlInput;
    private EditText deviceIdInput;
    private EditText googleClientIdInput;
    private Spinner intervalSpinner;
    private Button startButton;
    private Button stopButton;
    private Button shockButton;
    private TextView statusText;
    private TextView sensorText;
    private TextView authText;

    private volatile float accelX;
    private volatile float accelY;
    private volatile float accelZ;
    private volatile boolean shockPending;
    private volatile int tapCount;
    private volatile boolean running;
    private volatile String googleIdToken = "";
    private volatile String activeApiUrl = "";
    private volatile String activeDeviceId = "";
    private long nextRetryEpochMs;
    private int retryAttempt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        executor = Executors.newSingleThreadScheduledExecutor();
        sensorAggregator = new SensorWindowAggregator();
        SharedPreferences preferences = getSharedPreferences("offline_sensor_queue", MODE_PRIVATE);
        pendingPayloads = new PersistentPayloadQueue(new PersistentPayloadQueue.StringStore() {
            @Override
            public String get() {
                return preferences.getString("payloads", "");
            }

            @Override
            public void set(String value) {
                if (!preferences.edit().putString("payloads", value).commit()) {
                    throw new IllegalStateException("Could not persist offline queue");
                }
            }
        }, OFFLINE_QUEUE_CAPACITY);
        setContentView(buildLayout());
    }

    private View buildLayout() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
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
        apiUrlInput.setText(BuildConfig.SENSOR_API_URL);
        apiUrlInput.setEnabled(BuildConfig.API_URL_EDITABLE);
        apiUrlInput.setContentDescription("API URL");
        root.addView(label("API URL"));
        root.addView(apiUrlInput, fullWidth());

        deviceIdInput = new EditText(this);
        deviceIdInput.setHint("Device ID");
        deviceIdInput.setSingleLine(true);
        deviceIdInput.setText(defaultDeviceId());
        deviceIdInput.setContentDescription("Device ID");
        root.addView(label("Device ID"));
        root.addView(deviceIdInput, fullWidth());

        googleClientIdInput = new EditText(this);
        googleClientIdInput.setHint("Web OAuth Client ID");
        googleClientIdInput.setSingleLine(true);
        googleClientIdInput.setText(DEFAULT_GOOGLE_WEB_CLIENT_ID);
        googleClientIdInput.setContentDescription("Google Web OAuth Client ID");
        root.addView(label("Google Web Client ID"));
        root.addView(googleClientIdInput, fullWidth());

        Button googleSignInButton = new Button(this);
        googleSignInButton.setText("Google Sign In");
        root.addView(googleSignInButton, fullWidth());

        authText = new TextView(this);
        authText.setText("Auth: not signed in");
        authText.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(authText, fullWidth());

        intervalSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new String[]{"100 ms", "500 ms", "1000 ms"});
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        intervalSpinner.setAdapter(adapter);
        intervalSpinner.setSelection(1);
        intervalSpinner.setContentDescription("Send Interval");
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
        sensorText.setClickable(true);
        sensorText.setFocusable(true);
        sensorText.setContentDescription("Live accelerometer values. Activate to mark a shock event.");
        root.addView(sensorText, fullWidth());

        statusText = new TextView(this);
        statusText.setText("Status: idle");
        root.addView(statusText, fullWidth());

        startButton.setOnClickListener(view -> startSending());
        stopButton.setOnClickListener(view -> stopSending());
        shockButton.setOnClickListener(view -> markShock());
        sensorText.setOnClickListener(view -> markShock());
        googleSignInButton.setOnClickListener(view -> startGoogleSignIn());
        scroll.addView(root, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        return scroll;
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
        if (accelerometer == null) {
            setStatus("Status: accelerometer unavailable");
            return;
        }
        if (!googleClientIdInput.getText().toString().trim().isEmpty() && googleIdToken.isEmpty()) {
            setStatus("Status: Google Sign In required");
            return;
        }
        if (sensorAggregator.getSampleCount() > 0) {
            try {
                persistCurrentWindow(activeDeviceId);
            } catch (Exception error) {
                setStatus("Status: pending window storage failed, start blocked");
                return;
            }
        }
        activeApiUrl = ApiEndpointPolicy.resolve(
                BuildConfig.SENSOR_API_URL,
                apiUrlInput.getText().toString(),
                BuildConfig.API_URL_EDITABLE);
        activeDeviceId = deviceIdInput.getText().toString().trim();
        if (activeApiUrl.isEmpty() || activeDeviceId.isEmpty()) {
            setStatus(BuildConfig.API_URL_EDITABLE
                    ? "Status: API URL and Device ID required"
                    : "Status: API URL not configured");
            return;
        }
        running = true;
        startButton.setEnabled(false);
        stopButton.setEnabled(true);
        intervalSpinner.setEnabled(false);
        sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        int intervalMs = selectedIntervalMs();
        senderTask = executor.scheduleAtFixedRate(this::sendCurrentSample, 0, intervalMs, TimeUnit.MILLISECONDS);
        setStatus("Status: streaming, queued " + pendingPayloads.size());
    }

    private void stopSending() {
        running = false;
        if (senderTask != null) {
            senderTask.cancel(false);
            senderTask = null;
        }
        sensorManager.unregisterListener(this);
        try {
            persistCurrentWindow(activeDeviceId);
        } catch (Exception error) {
            setStatus("Status: stopped, pending window storage failed");
        }
        startButton.setEnabled(true);
        stopButton.setEnabled(false);
        intervalSpinner.setEnabled(true);
        if (sensorAggregator.getSampleCount() == 0) {
            setStatus("Status: stopped, queued " + pendingPayloads.size());
        }
    }

    private void markShock() {
        shockPending = true;
        tapCount += 1;
        setStatus("Status: shock marked");
    }

    private void sendCurrentSample() {
        try {
            persistCurrentWindow(activeDeviceId);
            flushPendingPayloads();
        } catch (Exception error) {
            scheduleRetry(error);
        }
    }

    private void persistCurrentWindow(String deviceId) throws Exception {
        if (sensorAggregator.getSampleCount() == 0) return;
        if (deviceId == null || deviceId.isEmpty()) {
            throw new IllegalStateException("Device ID required for pending window");
        }
        sensorAggregator.drainAfterCommit(System.currentTimeMillis(), window ->
                pendingPayloads.enqueue(buildPayload(window, deviceId)));
    }

    private String buildPayload(SensorWindowAggregator.Window window, String deviceId) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("eventId", window.getEventId());
        payload.put("deviceId", deviceId);
        payload.put("timestamp", Instant.ofEpochMilli(window.getWindowEndMillis()).toString());
        payload.put("accelX", window.getAverageX());
        payload.put("accelY", window.getAverageY());
        payload.put("accelZ", window.getAverageZ());
        payload.put("accelMagnitude", window.getRmsMagnitude());
        payload.put("peakMagnitude", window.getPeakMagnitude());
        payload.put("sampleCount", window.getSampleCount());
        payload.put("aggregationWindowMs", Math.max(1L, window.getWindowEndMillis() - window.getWindowStartMillis()));
        payload.put("shock", window.isShock());
        payload.put("tapCount", window.getTapCount());
        payload.put("batteryPercent", batteryPercent());
        payload.put("status", "ONLINE");
        return payload.toString();
    }

    private void flushPendingPayloads() throws Exception {
        long now = System.currentTimeMillis();
        if (now < nextRetryEpochMs) {
            long waitSeconds = Math.max(1L, (nextRetryEpochMs - now + 999L) / 1000L);
            setStatus("Status: offline, queued " + pendingPayloads.size() + ", retry in " + waitSeconds + " s");
            return;
        }
        int sent = 0;
        String payload;
        while ((payload = pendingPayloads.peek()) != null) {
            postJson(activeApiUrl, payload);
            pendingPayloads.remove();
            sent += 1;
        }
        retryAttempt = 0;
        nextRetryEpochMs = 0L;
        setStatus("Status: sent " + sent + ", queued " + pendingPayloads.size());
    }

    private void scheduleRetry(Exception error) {
        retryAttempt = Math.min(retryAttempt + 1, 10);
        long delayMs = Math.min(MAX_RETRY_DELAY_MS, 1000L << Math.min(retryAttempt - 1, 6));
        nextRetryEpochMs = System.currentTimeMillis() + delayMs;
        setStatus("Status: send failed " + error.getClass().getSimpleName() + ", queued " + pendingPayloads.size());
    }

    private void postJson(String apiUrl, String json) throws Exception {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        if (!googleIdToken.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + googleIdToken);
        }
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

    private void startGoogleSignIn() {
        String clientId = googleClientIdInput.getText().toString().trim();
        if (clientId.isEmpty()) {
            setStatus("Status: Web OAuth Client ID required");
            return;
        }
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestIdToken(clientId)
                .build();
        GoogleSignInClient client = GoogleSignIn.getClient(this, options);
        startActivityForResult(client.getSignInIntent(), GOOGLE_SIGN_IN_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != GOOGLE_SIGN_IN_REQUEST) return;
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            String token = account == null ? "" : account.getIdToken();
            if (token == null || token.isEmpty()) {
                throw new IllegalStateException("Missing Google ID token");
            }
            googleIdToken = token;
            String email = account.getEmail() == null ? "Google account" : account.getEmail();
            authText.setText("Auth: " + email);
            setStatus("Status: Google Sign In complete");
        } catch (Exception error) {
            googleIdToken = "";
            authText.setText("Auth: sign in failed");
            setStatus("Status: Google Sign In failed");
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        accelX = event.values[0];
        accelY = event.values[1];
        accelZ = event.values[2];
        double magnitude = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
        boolean shock = shockPending || magnitude > 14.0;
        shockPending = false;
        sensorAggregator.addSample(accelX, accelY, accelZ, shock, tapCount, System.currentTimeMillis());
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

    @Override
    protected void onStop() {
        if (running) stopSending();
        super.onStop();
    }
}
