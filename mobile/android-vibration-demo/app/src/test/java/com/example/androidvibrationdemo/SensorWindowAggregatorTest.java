package com.example.androidvibrationdemo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.UUID;
import org.junit.Test;

public final class SensorWindowAggregatorTest {
    private static final double TOLERANCE = 0.000001;

    @Test
    public void drainCalculatesWindowMetrics() {
        SensorWindowAggregator aggregator = new SensorWindowAggregator();
        aggregator.addSample(3.0, 4.0, 0.0, false, 7, 1_000L);
        aggregator.addSample(0.0, 0.0, 12.0, false, 9, 2_000L);

        SensorWindowAggregator.Window window = aggregator.drain(2_500L);

        assertEquals(1.5, window.getAverageX(), TOLERANCE);
        assertEquals(2.0, window.getAverageY(), TOLERANCE);
        assertEquals(6.0, window.getAverageZ(), TOLERANCE);
        assertEquals(Math.sqrt(84.5), window.getRmsMagnitude(), TOLERANCE);
        assertEquals(12.0, window.getPeakMagnitude(), TOLERANCE);
        assertEquals(9, window.getTapCount());
        assertEquals(2, window.getSampleCount());
        assertEquals(1_000L, window.getWindowStartMillis());
        assertEquals(2_500L, window.getWindowEndMillis());
        UUID.fromString(window.getEventId());
    }

    @Test
    public void drainResetsAllWindowState() {
        SensorWindowAggregator aggregator = new SensorWindowAggregator();
        aggregator.addSample(1.0, 2.0, 3.0, true, 4, 100L);

        SensorWindowAggregator.Window first = aggregator.drain(200L);

        assertEquals(0, aggregator.getSampleCount());
        assertNull(aggregator.drain(300L));

        aggregator.addSample(5.0, 6.0, 7.0, false, 1, 400L);
        SensorWindowAggregator.Window second = aggregator.drain();

        assertFalse(second.isShock());
        assertEquals(1, second.getTapCount());
        assertEquals(1, second.getSampleCount());
        assertEquals(400L, second.getWindowStartMillis());
        assertEquals(400L, second.getWindowEndMillis());
        assertFalse(first.getEventId().equals(second.getEventId()));
    }

    @Test
    public void shockIsOrAcrossEverySample() {
        SensorWindowAggregator aggregator = new SensorWindowAggregator();
        aggregator.addSample(0.0, 0.0, 1.0, false, 0, 10L);
        aggregator.addSample(0.0, 0.0, 2.0, true, 1, 20L);
        aggregator.addSample(0.0, 0.0, 3.0, false, 2, 30L);

        assertTrue(aggregator.drain(40L).isShock());
    }

    @Test
    public void failedCommitKeepsWindowForRetry() {
        SensorWindowAggregator aggregator = new SensorWindowAggregator();
        aggregator.addSample(1.0, 2.0, 3.0, true, 4, 100L);

        try {
            aggregator.drainAfterCommit(200L, window -> {
                throw new IllegalStateException("storage unavailable");
            });
        } catch (Exception expected) {
            assertEquals("storage unavailable", expected.getMessage());
        }

        assertEquals(1, aggregator.getSampleCount());
        SensorWindowAggregator.Window retried = aggregator.drain(300L);
        assertEquals(1, retried.getSampleCount());
        assertTrue(retried.isShock());
    }
}
