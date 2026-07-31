package com.example.androidvibrationdemo;

public final class ApiEndpointPolicy {
    private ApiEndpointPolicy() {
    }

    public static String resolve(String configuredUrl, String enteredUrl, boolean editable) {
        return normalize(editable ? enteredUrl : configuredUrl);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
