package ch.duartesantos.opengym;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.units.Mass;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

// v1.4.3: what HealthConnectPlugin hands to JS when it reads heart rate and weigh-ins back.
public class HealthReadTest {

    private static HeartRateRecord hr(long start, long end, long[][] samples) {
        HeartRateRecord.Sample[] s = new HeartRateRecord.Sample[samples.length];
        for (int i = 0; i < samples.length; i++) s[i] = new HeartRateRecord.Sample(Instant.ofEpochMilli(samples[i][0]), samples[i][1]);
        return new HeartRateRecord(Instant.ofEpochMilli(start), ZoneOffset.UTC, Instant.ofEpochMilli(end), ZoneOffset.UTC,
                Arrays.asList(s), Metadata.unknownRecordingMethod());
    }

    @Test
    public void samplesInsideTheWindowOldestFirst() {
        HeartRateRecord a = hr(10_000, 20_000, new long[][] { { 10_000, 120 }, { 15_000, 130 }, { 20_000, 140 } });
        HeartRateRecord b = hr(0, 9_000, new long[][] { { 0, 90 }, { 9_000, 100 } });
        List<long[]> out = HealthRead.samples(Arrays.asList(a, b), 5_000, 15_000);
        assertEquals(3, out.size());
        assertArrayEquals(new long[] { 9_000, 100 }, out.get(0));
        assertArrayEquals(new long[] { 10_000, 120 }, out.get(1));
        assertArrayEquals(new long[] { 15_000, 130 }, out.get(2));
    }

    @Test
    public void implausibleBeatsAreLeftOut() {
        HeartRateRecord a = hr(0, 3_000, new long[][] { { 0, 10 }, { 1_000, 300 }, { 2_000, 25 }, { 3_000, 250 } });
        List<long[]> out = HealthRead.samples(Collections.singletonList(a), 0, 3_000);
        assertEquals(2, out.size());
        assertEquals(25, out.get(0)[1]);
        assertEquals(250, out.get(1)[1]);
    }

    @Test
    public void weighInsCarryTheirOriginAndClientId() {
        Metadata scale = new Metadata(Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, "rec-1", new DataOrigin("com.withings.wiscale2"),
                Instant.ofEpochMilli(5), null, 0, null);
        Metadata ours = new Metadata(Metadata.RECORDING_METHOD_MANUAL_ENTRY, "rec-2", new DataOrigin("ch.duartesantos.opengym"),
                Instant.ofEpochMilli(5), "opengym-bw-2026-10-15", 1, null);
        List<HealthRead.Weight> out = HealthRead.weights(Arrays.asList(
                new WeightRecord(Instant.ofEpochMilli(1_000), ZoneOffset.UTC, Mass.kilograms(81.25), scale),
                new WeightRecord(Instant.ofEpochMilli(2_000), ZoneOffset.UTC, Mass.pounds(176), ours)));
        assertEquals(2, out.size());
        assertEquals(1_000, out.get(0).t);
        assertEquals(81.25, out.get(0).kg, 1e-9);
        assertEquals("com.withings.wiscale2", out.get(0).origin);
        assertNull(out.get(0).clientId);
        assertEquals("opengym-bw-2026-10-15", out.get(1).clientId);
        assertEquals(79.83, out.get(1).kg, 0.01);
    }

    @Test
    public void permissionNamesMatchTheManifest() {
        assertEquals("android.permission.health.READ_HEART_RATE", HealthRead.readPermission("heartRate"));
        assertEquals("android.permission.health.READ_WEIGHT", HealthRead.readPermission("weight"));
        assertEquals("android.permission.health.READ_HEALTH_DATA_HISTORY", HealthRead.readPermission("history"));
        assertEquals("android.permission.health.WRITE_EXERCISE", HealthRead.writePermission("exercise"));
        assertNull(HealthRead.readPermission("sleep"));
    }

    // GymTrack: runs read back from Health Connect.
    @Test
    public void namesTheSessionTypesRunsNeed() {
        assertEquals("running", HealthRead.typeName(ExerciseSessionRecord.EXERCISE_TYPE_RUNNING));
        assertEquals("running_treadmill", HealthRead.typeName(ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL));
        assertEquals("other", HealthRead.typeName(ExerciseSessionRecord.EXERCISE_TYPE_YOGA));
        assertEquals("android.permission.health.READ_EXERCISE", HealthRead.readPermission("exercise"));
        assertEquals("android.permission.health.READ_DISTANCE", HealthRead.readPermission("distance"));
    }

    @Test
    public void sumsOnlyTheSessionsOwnDistanceInsideIt() {
        HealthRead.Session s = new HealthRead.Session("s", "watch", null, 1_000_000, 2_800_000, "running", null);
        java.util.List<HealthRead.Dist> d = java.util.Arrays.asList(
                new HealthRead.Dist(1_000_000, 1_900_000, "watch", 2500),
                new HealthRead.Dist(1_900_000, 2_830_000, "watch", 2700),   // ends in the slack
                new HealthRead.Dist(1_000_000, 2_800_000, "phone", 5100),   // another app: not added
                new HealthRead.Dist(3_000_000, 3_600_000, "watch", 900));   // after the run
        assertEquals(5200, HealthRead.metersFor(s, d), 0.001);
    }

    @Test
    public void thinsSamplesForTheTripToJs() {
        java.util.List<long[]> hr = java.util.Arrays.asList(new long[] { 0, 100 }, new long[] { 1000, 101 }, new long[] { 5000, 120 }, new long[] { 9000, 130 }, new long[] { 10000, 131 });
        assertEquals(3, HealthRead.thinHr(hr).size());
        java.util.List<double[]> sp = java.util.Arrays.asList(new double[] { 6000, 3.1 }, new double[] { 0, 3.0 }, new double[] { 20000, 40 }, new double[] { 99000, 3.2 });
        java.util.List<double[]> out = HealthRead.thinSpeed(sp, 0, 60000);
        assertEquals(2, out.size());              // sorted, inside the window, no 40 m/s glitch
        assertEquals(0, out.get(0)[0], 0.001);
        assertEquals("android.permission.health.READ_VO2_MAX", HealthRead.readPermission("vo2max"));
    }
}
