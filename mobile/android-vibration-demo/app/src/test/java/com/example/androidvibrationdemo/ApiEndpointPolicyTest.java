package com.example.androidvibrationdemo;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class ApiEndpointPolicyTest {
    @Test
    public void debugBuildUsesEditedUrl() {
        assertEquals(
                "https://debug.example.test/api/mobile-sensor",
                ApiEndpointPolicy.resolve(
                        "https://configured.example.test/api/mobile-sensor",
                        "  https://debug.example.test/api/mobile-sensor  ",
                        true));
    }

    @Test
    public void releaseBuildAlwaysUsesConfiguredUrl() {
        assertEquals(
                "https://configured.example.test/api/mobile-sensor",
                ApiEndpointPolicy.resolve(
                        "  https://configured.example.test/api/mobile-sensor  ",
                        "https://edited.example.test/api/mobile-sensor",
                        false));
    }

    @Test
    public void missingReleaseConfigurationRemainsEmpty() {
        assertEquals("", ApiEndpointPolicy.resolve(null, "https://edited.example.test", false));
    }
}
