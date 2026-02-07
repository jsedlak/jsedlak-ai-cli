# Orleans Code Samples

Complete, working examples demonstrating key Orleans patterns. Reference these when implementing Orleans features.

## Table of Contents

- [Complex Grain Identity](#complex-grain-identity)
- [Grain with Persistence](#grain-with-persistence)
- [Streaming Producer and Consumer](#streaming-producer-and-consumer)
- [Implicit Stream Subscription](#implicit-stream-subscription)
- [Broadcast Channel](#broadcast-channel)
- [Observer Pattern](#observer-pattern)
- [Grain Call Filter (Interceptor)](#grain-call-filter-interceptor)
- [Stateless Worker](#stateless-worker)
- [Grain Service](#grain-service)
- [Silo Configuration (Complete)](#silo-configuration-complete)

---

## Complex Grain Identity

Multi-tenant grain with a composite string key using the readonly record struct pattern.

```csharp
// --- Identity ---

[GenerateSerializer]
public readonly record struct TenantResourceId(string TenantId, string ResourceId)
{
    private const char Separator = '/';

    public override string ToString() => $"{TenantId}{Separator}{ResourceId}";

    public static TenantResourceId Parse(string value)
    {
        var index = value.IndexOf(Separator);
        if (index < 0)
            throw new FormatException($"Invalid TenantResourceId format: '{value}'");

        return new TenantResourceId(value[..index], value[(index + 1)..]);
    }

    public static implicit operator string(TenantResourceId id) => id.ToString();
}

// --- Three-segment identity ---

[GenerateSerializer]
public readonly record struct TenantCategoryItemId(
    string TenantId, string Category, string ItemId)
{
    private const char Separator = '/';

    public override string ToString() =>
        $"{TenantId}{Separator}{Category}{Separator}{ItemId}";

    public static TenantCategoryItemId Parse(string value)
    {
        var parts = value.Split(Separator, 3);
        if (parts.Length != 3)
            throw new FormatException(
                $"Invalid TenantCategoryItemId format: '{value}'");

        return new TenantCategoryItemId(parts[0], parts[1], parts[2]);
    }

    public static implicit operator string(TenantCategoryItemId id) => id.ToString();
}

// --- Interface ---

public interface IDocumentGrain : IGrainWithStringKey
{
    Task<DocumentInfo> GetInfo();
    Task UpdateContent(string content);
}

// --- Implementation ---

[GenerateSerializer]
public class DocumentState
{
    [Id(0)] public string Content { get; set; } = string.Empty;
    [Id(1)] public DateTimeOffset LastModified { get; set; }
    [Id(2)] public string ModifiedBy { get; set; } = string.Empty;
}

public class DocumentGrain : Grain, IDocumentGrain
{
    private readonly IPersistentState<DocumentState> _state;
    private TenantResourceId _id;

    public DocumentGrain(
        [PersistentState("document", "documentStore")]
        IPersistentState<DocumentState> state)
    {
        _state = state;
    }

    public override Task OnActivateAsync(CancellationToken cancellationToken)
    {
        _id = TenantResourceId.Parse(this.GetPrimaryKeyString());
        return base.OnActivateAsync(cancellationToken);
    }

    public Task<DocumentInfo> GetInfo() =>
        Task.FromResult(new DocumentInfo
        {
            TenantId = _id.TenantId,
            ResourceId = _id.ResourceId,
            LastModified = _state.State.LastModified
        });

    public async Task UpdateContent(string content)
    {
        _state.State.Content = content;
        _state.State.LastModified = DateTimeOffset.UtcNow;
        await _state.WriteStateAsync();
    }
}

// --- Usage ---

var id = new TenantResourceId("acme-corp", "doc-12345");
var grain = grainFactory.GetGrain<IDocumentGrain>(id.ToString());
await grain.UpdateContent("Hello, world!");
```

---

## Grain with Persistence

Grain with multiple persistent state objects using different storage providers.

```csharp
// --- State Classes ---

[GenerateSerializer]
public class PlayerProfileState
{
    [Id(0)] public string DisplayName { get; set; } = string.Empty;
    [Id(1)] public string AvatarUrl { get; set; } = string.Empty;
    [Id(2)] public DateTimeOffset JoinedAt { get; set; }
}

[GenerateSerializer]
public class PlayerStatsState
{
    [Id(0)] public int GamesPlayed { get; set; }
    [Id(1)] public int Wins { get; set; }
    [Id(2)] public int Losses { get; set; }
    [Id(3)] public double Rating { get; set; } = 1000.0;
}

// --- Interface ---

public interface IPlayerGrain : IGrainWithGuidKey
{
    Task<PlayerProfileState> GetProfile();
    Task SetDisplayName(string name);
    Task RecordGameResult(bool won);
    Task<PlayerStatsState> GetStats();
}

// --- Implementation ---

public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerProfileState> _profile;
    private readonly IPersistentState<PlayerStatsState> _stats;

    public PlayerGrain(
        [PersistentState("profile", "profileStore")]
        IPersistentState<PlayerProfileState> profile,
        [PersistentState("stats", "statsStore")]
        IPersistentState<PlayerStatsState> stats)
    {
        _profile = profile;
        _stats = stats;
    }

    public override Task OnActivateAsync(CancellationToken cancellationToken)
    {
        if (!_profile.RecordExists)
        {
            _profile.State.JoinedAt = DateTimeOffset.UtcNow;
        }
        return base.OnActivateAsync(cancellationToken);
    }

    public Task<PlayerProfileState> GetProfile() =>
        Task.FromResult(_profile.State);

    public async Task SetDisplayName(string name)
    {
        _profile.State.DisplayName = name;
        await _profile.WriteStateAsync();
    }

    public async Task RecordGameResult(bool won)
    {
        _stats.State.GamesPlayed++;
        if (won)
        {
            _stats.State.Wins++;
            _stats.State.Rating += 25;
        }
        else
        {
            _stats.State.Losses++;
            _stats.State.Rating = Math.Max(0, _stats.State.Rating - 20);
        }
        await _stats.WriteStateAsync();
    }

    public Task<PlayerStatsState> GetStats() =>
        Task.FromResult(_stats.State);
}
```

---

## Streaming Producer and Consumer

Explicit subscription with proper reactivation handling.

```csharp
// --- Events ---

[GenerateSerializer]
public class SensorReading
{
    [Id(0)] public string SensorId { get; set; }
    [Id(1)] public double Value { get; set; }
    [Id(2)] public DateTimeOffset Timestamp { get; set; }
}

// --- Producer ---

public interface ISensorGrain : IGrainWithStringKey
{
    Task ReportReading(double value);
}

public class SensorGrain : Grain, ISensorGrain
{
    public async Task ReportReading(double value)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("SensorData", this.GetPrimaryKeyString());
        var stream = streamProvider.GetStream<SensorReading>(streamId);

        await stream.OnNextAsync(new SensorReading
        {
            SensorId = this.GetPrimaryKeyString(),
            Value = value,
            Timestamp = DateTimeOffset.UtcNow
        });
    }
}

// --- Consumer with explicit subscription ---

public interface ISensorMonitorGrain : IGrainWithStringKey
{
    Task StartMonitoring(string sensorId);
    Task StopMonitoring();
    Task<List<SensorReading>> GetRecentReadings();
}

public class SensorMonitorGrain : Grain, ISensorMonitorGrain
{
    private readonly IPersistentState<MonitorState> _state;
    private readonly List<SensorReading> _recentReadings = new();
    private StreamSubscriptionHandle<SensorReading> _handle;

    public SensorMonitorGrain(
        [PersistentState("monitor", "Default")]
        IPersistentState<MonitorState> state)
    {
        _state = state;
    }

    public override async Task OnActivateAsync(CancellationToken cancellationToken)
    {
        // Resume existing subscriptions after reactivation
        if (_state.State.MonitoredSensorId is not null)
        {
            var streamProvider = this.GetStreamProvider("StreamProvider");
            var streamId = StreamId.Create("SensorData", _state.State.MonitoredSensorId);
            var stream = streamProvider.GetStream<SensorReading>(streamId);

            var handles = await stream.GetAllSubscriptionHandles();
            foreach (var handle in handles)
            {
                await handle.ResumeAsync(OnReadingReceived);
            }
        }

        await base.OnActivateAsync(cancellationToken);
    }

    public async Task StartMonitoring(string sensorId)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("SensorData", sensorId);
        var stream = streamProvider.GetStream<SensorReading>(streamId);

        _handle = await stream.SubscribeAsync(OnReadingReceived);

        _state.State.MonitoredSensorId = sensorId;
        await _state.WriteStateAsync();
    }

    public async Task StopMonitoring()
    {
        if (_handle is not null)
        {
            await _handle.UnsubscribeAsync();
            _handle = null;
        }

        _state.State.MonitoredSensorId = null;
        await _state.WriteStateAsync();
    }

    public Task<List<SensorReading>> GetRecentReadings() =>
        Task.FromResult(_recentReadings.ToList());

    private Task OnReadingReceived(SensorReading reading, StreamSequenceToken token)
    {
        _recentReadings.Add(reading);
        if (_recentReadings.Count > 100)
            _recentReadings.RemoveAt(0);
        return Task.CompletedTask;
    }
}

[GenerateSerializer]
public class MonitorState
{
    [Id(0)] public string MonitoredSensorId { get; set; }
}
```

---

## Implicit Stream Subscription

Grain that is automatically activated when events arrive on a matching stream.

```csharp
// --- Events ---

[GenerateSerializer]
public class OrderEvent
{
    [Id(0)] public string OrderId { get; set; }
    [Id(1)] public string Action { get; set; }  // "placed", "shipped", "delivered"
    [Id(2)] public DateTimeOffset Timestamp { get; set; }
}

// --- Implicitly subscribed consumer ---

public interface IOrderTrackerGrain : IGrainWithGuidKey
{
    Task<List<OrderEvent>> GetHistory();
}

[ImplicitStreamSubscription("Orders")]
public class OrderTrackerGrain : Grain, IOrderTrackerGrain, IAsyncObserver<OrderEvent>
{
    private readonly IPersistentState<OrderTrackerState> _state;

    public OrderTrackerGrain(
        [PersistentState("tracker", "Default")]
        IPersistentState<OrderTrackerState> state)
    {
        _state = state;
    }

    public override async Task OnActivateAsync(CancellationToken cancellationToken)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("Orders", this.GetPrimaryKey());
        var stream = streamProvider.GetStream<OrderEvent>(streamId);

        await stream.SubscribeAsync(this);
        await base.OnActivateAsync(cancellationToken);
    }

    public async Task OnNextAsync(OrderEvent item, StreamSequenceToken token = null)
    {
        _state.State.Events.Add(item);
        await _state.WriteStateAsync();
    }

    public Task OnCompletedAsync() => Task.CompletedTask;
    public Task OnErrorAsync(Exception ex) => Task.CompletedTask;

    public Task<List<OrderEvent>> GetHistory() =>
        Task.FromResult(_state.State.Events.ToList());
}

[GenerateSerializer]
public class OrderTrackerState
{
    [Id(0)] public List<OrderEvent> Events { get; set; } = new();
}

// --- Producer (in another grain or service) ---

public async Task PlaceOrder(Guid orderId)
{
    var streamProvider = this.GetStreamProvider("StreamProvider");
    var streamId = StreamId.Create("Orders", orderId);
    var stream = streamProvider.GetStream<OrderEvent>(streamId);

    await stream.OnNextAsync(new OrderEvent
    {
        OrderId = orderId.ToString(),
        Action = "placed",
        Timestamp = DateTimeOffset.UtcNow
    });

    // This automatically activates the OrderTrackerGrain with the same Guid key
}
```

---

## Broadcast Channel

One-to-many event distribution from non-grain code to grain consumers.

```csharp
// --- Event ---

[GenerateSerializer]
public class ConfigChangeEvent
{
    [Id(0)] public string Key { get; set; }
    [Id(1)] public string NewValue { get; set; }
    [Id(2)] public DateTimeOffset ChangedAt { get; set; }
}

// --- Consumer grain ---

public interface IConfigListenerGrain : IGrainWithStringKey
{
    Task<Dictionary<string, string>> GetCurrentConfig();
}

[ImplicitChannelSubscription("ConfigChanges")]
public class ConfigListenerGrain : Grain, IConfigListenerGrain, IOnBroadcastChannelSubscribed
{
    private readonly Dictionary<string, string> _config = new();

    public Task OnSubscribed(IBroadcastChannelSubscription subscription)
    {
        return subscription.Attach<ConfigChangeEvent>(
            onPublished: async evt =>
            {
                _config[evt.Key] = evt.NewValue;
                await Task.CompletedTask;
            },
            onError: ex =>
            {
                // Log the error
                return Task.CompletedTask;
            });
    }

    public Task<Dictionary<string, string>> GetCurrentConfig() =>
        Task.FromResult(new Dictionary<string, string>(_config));
}

// --- Publisher (e.g., from an ASP.NET Core endpoint) ---

// Silo configuration:
// siloBuilder.AddBroadcastChannel("ConfigChannel");

// In a controller or service:
public class ConfigController : ControllerBase
{
    private readonly IClusterClient _client;

    public ConfigController(IClusterClient client) => _client = client;

    [HttpPut("config/{key}")]
    public async Task<IActionResult> UpdateConfig(string key, [FromBody] string value)
    {
        var provider = _client.ServiceProvider
            .GetRequiredKeyedService<IBroadcastChannelProvider>("ConfigChannel");
        var channelId = ChannelId.Create("ConfigChanges", key);
        var writer = provider.GetChannelWriter<ConfigChangeEvent>(channelId);

        await writer.Publish(new ConfigChangeEvent
        {
            Key = key,
            NewValue = value,
            ChangedAt = DateTimeOffset.UtcNow
        });

        return Ok();
    }
}
```

---

## Observer Pattern

Client-to-grain notification with ObserverManager.

```csharp
// --- Observer interface ---

public interface IGameObserver : IGrainObserver
{
    [OneWay]  // Fire-and-forget for notifications
    Task OnPlayerJoined(string playerName);

    [OneWay]
    Task OnPlayerLeft(string playerName);

    [OneWay]
    Task OnGameStateChanged(GameState state);
}

// --- Grain managing observers ---

[GenerateSerializer]
public class GameState
{
    [Id(0)] public List<string> Players { get; set; } = new();
    [Id(1)] public string Status { get; set; } = "waiting";
}

public interface IGameLobbyGrain : IGrainWithStringKey
{
    Task Subscribe(IGameObserver observer);
    Task Unsubscribe(IGameObserver observer);
    Task Join(string playerName);
    Task Leave(string playerName);
    Task<GameState> GetState();
}

public class GameLobbyGrain : Grain, IGameLobbyGrain
{
    private readonly ObserverManager<IGameObserver> _observers;
    private readonly GameState _state = new();

    public GameLobbyGrain(ILogger<GameLobbyGrain> logger)
    {
        _observers = new ObserverManager<IGameObserver>(
            TimeSpan.FromMinutes(5), logger);
    }

    public Task Subscribe(IGameObserver observer)
    {
        _observers.Subscribe(observer, observer);
        return Task.CompletedTask;
    }

    public Task Unsubscribe(IGameObserver observer)
    {
        _observers.Unsubscribe(observer);
        return Task.CompletedTask;
    }

    public Task Join(string playerName)
    {
        _state.Players.Add(playerName);
        _observers.Notify(o => o.OnPlayerJoined(playerName));
        _observers.Notify(o => o.OnGameStateChanged(_state));
        return Task.CompletedTask;
    }

    public Task Leave(string playerName)
    {
        _state.Players.Remove(playerName);
        _observers.Notify(o => o.OnPlayerLeft(playerName));
        _observers.Notify(o => o.OnGameStateChanged(_state));
        return Task.CompletedTask;
    }

    public Task<GameState> GetState() => Task.FromResult(_state);
}

// --- Client-side observer implementation ---

public class GameObserverClient : IGameObserver
{
    public Task OnPlayerJoined(string playerName)
    {
        Console.WriteLine($"{playerName} joined the game.");
        return Task.CompletedTask;
    }

    public Task OnPlayerLeft(string playerName)
    {
        Console.WriteLine($"{playerName} left the game.");
        return Task.CompletedTask;
    }

    public Task OnGameStateChanged(GameState state)
    {
        Console.WriteLine($"Game state: {state.Status}, Players: {state.Players.Count}");
        return Task.CompletedTask;
    }
}

// --- Client registration ---

var observerClient = new GameObserverClient();  // Keep a strong reference!
var observerRef = client.GetGrain<IGameLobbyGrain>("lobby-1");
var objRef = client.CreateObjectReference<IGameObserver>(observerClient);
await observerRef.Subscribe(objRef);

// Resubscribe periodically to keep the subscription alive:
var timer = new PeriodicTimer(TimeSpan.FromMinutes(3));
while (await timer.WaitForNextTickAsync())
{
    await observerRef.Subscribe(objRef);
}
```

---

## Grain Call Filter (Interceptor)

Logging and authorization filters.

```csharp
// --- Logging filter (silo-wide) ---

public class PerformanceFilter : IIncomingGrainCallFilter
{
    private readonly ILogger<PerformanceFilter> _logger;

    public PerformanceFilter(ILogger<PerformanceFilter> logger) =>
        _logger = logger;

    public async Task Invoke(IIncomingGrainCallContext context)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await context.Invoke();
        }
        finally
        {
            stopwatch.Stop();
            if (stopwatch.ElapsedMilliseconds > 100)
            {
                _logger.LogWarning(
                    "Slow grain call: {Interface}.{Method} took {ElapsedMs}ms",
                    context.InterfaceName,
                    context.MethodName,
                    stopwatch.ElapsedMilliseconds);
            }
        }
    }
}

// --- Authorization filter (silo-wide) ---

public class AuthorizationFilter : IIncomingGrainCallFilter
{
    public async Task Invoke(IIncomingGrainCallContext context)
    {
        // Check for [Authorize] attribute on the implementation method
        var authAttr = context.ImplementationMethod?
            .GetCustomAttribute<AuthorizeAttribute>();

        if (authAttr is not null)
        {
            var token = RequestContext.Get("auth-token") as string;
            if (string.IsNullOrEmpty(token))
                throw new UnauthorizedAccessException(
                    $"Unauthorized call to {context.InterfaceName}.{context.MethodName}");
        }

        await context.Invoke();
    }
}

[AttributeUsage(AttributeTargets.Method)]
public class AuthorizeAttribute : Attribute { }

// --- Per-grain filter ---

public class AuditedGrain : Grain, IAuditedGrain, IIncomingGrainCallFilter
{
    private readonly ILogger<AuditedGrain> _logger;

    public AuditedGrain(ILogger<AuditedGrain> logger) => _logger = logger;

    public async Task Invoke(IIncomingGrainCallContext context)
    {
        _logger.LogInformation(
            "Grain {GrainId} method {Method} called by {Source}",
            this.GetPrimaryKeyString(),
            context.MethodName,
            context.SourceId?.ToString() ?? "client");

        await context.Invoke();

        _logger.LogInformation(
            "Grain {GrainId} method {Method} completed",
            this.GetPrimaryKeyString(),
            context.MethodName);
    }

    // ... grain methods
}

// --- Outgoing filter for context propagation ---

public class CorrelationIdFilter : IOutgoingGrainCallFilter
{
    public async Task Invoke(IOutgoingGrainCallContext context)
    {
        // Ensure correlation ID propagates across grain calls
        if (RequestContext.Get("correlation-id") is null)
        {
            RequestContext.Set("correlation-id", Guid.NewGuid().ToString());
        }

        await context.Invoke();
    }
}

// --- Registration ---

// siloBuilder.AddIncomingGrainCallFilter<PerformanceFilter>();
// siloBuilder.AddIncomingGrainCallFilter<AuthorizationFilter>();
// siloBuilder.AddOutgoingGrainCallFilter<CorrelationIdFilter>();
// siloBuilder.AddActivityPropagation();  // Built-in System.Diagnostics.Activity support
```

---

## Stateless Worker

Parallel computation with auto-scaling.

```csharp
// --- Interface ---

public interface IImageProcessorGrain : IGrainWithIntegerKey
{
    Task<byte[]> ResizeImage(byte[] imageData, int width, int height);
    Task<string> ExtractText(byte[] imageData);
}

// --- Stateless worker implementation ---

[StatelessWorker(maxLocalWorkers: 8)]
[Reentrant]  // Allow concurrent async operations
public class ImageProcessorGrain : Grain, IImageProcessorGrain
{
    private readonly ILogger<ImageProcessorGrain> _logger;

    public ImageProcessorGrain(ILogger<ImageProcessorGrain> logger) =>
        _logger = logger;

    public async Task<byte[]> ResizeImage(byte[] imageData, int width, int height)
    {
        _logger.LogDebug("Resizing image to {W}x{H}", width, height);
        // Perform CPU-intensive image resizing
        return await Task.Run(() => DoResize(imageData, width, height));
    }

    public async Task<string> ExtractText(byte[] imageData)
    {
        // Call external OCR service
        return await CallOcrService(imageData);
    }

    private byte[] DoResize(byte[] data, int w, int h) { /* ... */ return data; }
    private Task<string> CallOcrService(byte[] data) => Task.FromResult("extracted text");
}

// --- Usage (fan-out with stateless workers) ---

public class BatchProcessorGrain : Grain, IBatchProcessorGrain
{
    public async Task<List<string>> ProcessBatch(List<byte[]> images)
    {
        // All calls to the same worker ID will be distributed across
        // multiple activations automatically
        var worker = GrainFactory.GetGrain<IImageProcessorGrain>(0);

        var tasks = images.Select(img => worker.ExtractText(img));
        var results = await Task.WhenAll(tasks);

        return results.ToList();
    }
}
```

---

## Grain Service

Background silo-level service that participates in the consistent hash ring.

```csharp
// --- Interface ---

public interface ILeaderboardService : IGrainService
{
    Task ReportScore(string playerId, int score);
    Task<List<LeaderboardEntry>> GetTopScores(int count);
}

[GenerateSerializer]
public class LeaderboardEntry
{
    [Id(0)] public string PlayerId { get; set; }
    [Id(1)] public int Score { get; set; }
}

// --- Implementation ---

[Reentrant]
public class LeaderboardService : GrainService, ILeaderboardService
{
    private readonly IGrainFactory _grainFactory;
    private readonly ILogger<LeaderboardService> _logger;
    private readonly SortedDictionary<int, HashSet<string>> _scores = new();
    private IGrainTimer _cleanupTimer;

    public LeaderboardService(
        IServiceProvider services,
        GrainId id,
        Silo silo,
        ILoggerFactory loggerFactory,
        IGrainFactory grainFactory)
        : base(id, silo, loggerFactory)
    {
        _grainFactory = grainFactory;
        _logger = loggerFactory.CreateLogger<LeaderboardService>();
    }

    public override async Task Start()
    {
        await base.Start();
        _logger.LogInformation("LeaderboardService started on silo");

        _cleanupTimer = this.RegisterGrainTimer(
            callback: static async (state, ct) =>
            {
                state._logger.LogDebug("Running periodic cleanup");
                // Periodic maintenance
            },
            state: this,
            options: new GrainTimerCreationOptions
            {
                DueTime = TimeSpan.FromMinutes(5),
                Period = TimeSpan.FromMinutes(5)
            });
    }

    public override async Task Stop()
    {
        _cleanupTimer?.Dispose();
        await base.Stop();
    }

    public Task ReportScore(string playerId, int score)
    {
        if (!_scores.TryGetValue(score, out var players))
        {
            players = new HashSet<string>();
            _scores[score] = players;
        }
        players.Add(playerId);
        return Task.CompletedTask;
    }

    public Task<List<LeaderboardEntry>> GetTopScores(int count)
    {
        var results = _scores
            .Reverse()
            .SelectMany(kvp => kvp.Value.Select(p =>
                new LeaderboardEntry { PlayerId = p, Score = kvp.Key }))
            .Take(count)
            .ToList();
        return Task.FromResult(results);
    }
}

// --- Client proxy ---

public interface ILeaderboardServiceClient
    : IGrainServiceClient<ILeaderboardService>, ILeaderboardService
{
}

public class LeaderboardServiceClient
    : GrainServiceClient<ILeaderboardService>, ILeaderboardServiceClient
{
    public LeaderboardServiceClient(IServiceProvider serviceProvider)
        : base(serviceProvider) { }

    private ILeaderboardService GrainService =>
        GetGrainService(CurrentGrainReference.GrainId);

    public Task ReportScore(string playerId, int score) =>
        GrainService.ReportScore(playerId, score);

    public Task<List<LeaderboardEntry>> GetTopScores(int count) =>
        GrainService.GetTopScores(count);
}

// --- Registration ---

// siloBuilder.AddGrainService<LeaderboardService>();
// siloBuilder.ConfigureServices(services =>
// {
//     services.AddSingleton<ILeaderboardServiceClient, LeaderboardServiceClient>();
// });

// --- Usage from a grain ---

public class GameGrain : Grain, IGameGrain
{
    private readonly ILeaderboardServiceClient _leaderboard;

    public GameGrain(ILeaderboardServiceClient leaderboard)
    {
        _leaderboard = leaderboard;
    }

    public async Task EndGame(string playerId, int finalScore)
    {
        await _leaderboard.ReportScore(playerId, finalScore);
    }
}
```

---

## Silo Configuration (Complete)

Full silo setup with all major features configured.

```csharp
using Microsoft.Extensions.Hosting;
using Orleans.Configuration;
using System.Net;

var builder = WebApplication.CreateBuilder(args);

builder.UseOrleans(siloBuilder =>
{
    // --- Cluster identity ---
    siloBuilder.Configure<ClusterOptions>(options =>
    {
        options.ClusterId = "my-cluster";
        options.ServiceId = "my-service";  // Must be stable across deployments
    });

    // --- Clustering ---
    if (builder.Environment.IsDevelopment())
    {
        siloBuilder.UseLocalhostClustering();
    }
    else
    {
        siloBuilder.Configure<EndpointOptions>(options =>
        {
            options.SiloPort = 11_111;
            options.GatewayPort = 30_000;
        });
        siloBuilder.UseAzureStorageClustering(options =>
        {
            options.ConfigureTableServiceClient(
                builder.Configuration.GetConnectionString("Clustering"));
        });
    }

    // --- Persistence ---
    siloBuilder.AddMemoryGrainStorage("Default");  // For non-critical state
    siloBuilder.AddAzureBlobGrainStorage("profileStore", options =>
    {
        options.ConfigureBlobServiceClient(
            builder.Configuration.GetConnectionString("Storage"));
    });
    siloBuilder.AddRedisGrainStorage("cacheStore", options =>
    {
        options.ConnectionString =
            builder.Configuration.GetConnectionString("Redis");
    });

    // --- Streams ---
    siloBuilder.AddMemoryStreams("StreamProvider");
    siloBuilder.AddMemoryGrainStorage("PubSubStore");

    // --- Broadcast channels ---
    siloBuilder.AddBroadcastChannel("Notifications", options =>
    {
        options.FireAndForgetDelivery = true;
    });

    // --- Grain services ---
    siloBuilder.AddGrainService<LeaderboardService>();
    siloBuilder.ConfigureServices(services =>
    {
        services.AddSingleton<ILeaderboardServiceClient, LeaderboardServiceClient>();
    });

    // --- Interceptors / Filters ---
    siloBuilder.AddIncomingGrainCallFilter<PerformanceFilter>();
    siloBuilder.AddIncomingGrainCallFilter<AuthorizationFilter>();
    siloBuilder.AddOutgoingGrainCallFilter<CorrelationIdFilter>();
    siloBuilder.AddActivityPropagation();

    // --- Reminders ---
    if (builder.Environment.IsDevelopment())
    {
        siloBuilder.UseInMemoryReminderService();
    }
    else
    {
        siloBuilder.UseAzureTableReminderService(options =>
        {
            options.ConfigureTableServiceClient(
                builder.Configuration.GetConnectionString("Clustering"));
        });
    }
});

var app = builder.Build();

// --- Map API endpoints ---

app.MapGet("/player/{id:guid}/profile", async (Guid id, IClusterClient client) =>
{
    var grain = client.GetGrain<IPlayerGrain>(id);
    return await grain.GetProfile();
});

app.MapPost("/player/{id:guid}/name", async (Guid id, string name, IClusterClient client) =>
{
    var grain = client.GetGrain<IPlayerGrain>(id);
    await grain.SetDisplayName(name);
    return Results.Ok();
});

app.Run();
```

---

## Testing Example

Integration test using TestCluster.

```csharp
using Orleans.TestingHost;
using Xunit;

public class TestSiloConfig : ISiloConfigurator
{
    public void Configure(ISiloBuilder siloBuilder)
    {
        siloBuilder.AddMemoryGrainStorage("Default");
        siloBuilder.AddMemoryGrainStorage("profileStore");
        siloBuilder.AddMemoryGrainStorage("statsStore");
        siloBuilder.AddMemoryStreams("StreamProvider");
        siloBuilder.AddMemoryGrainStorage("PubSubStore");
    }
}

public class PlayerGrainTests : IAsyncLifetime
{
    private TestCluster _cluster;

    public async Task InitializeAsync()
    {
        var builder = new TestClusterBuilder();
        builder.AddSiloBuilderConfigurator<TestSiloConfig>();
        _cluster = builder.Build();
        await _cluster.DeployAsync();
    }

    public async Task DisposeAsync()
    {
        await _cluster.StopAllSilosAsync();
    }

    [Fact]
    public async Task SetDisplayName_PersistsName()
    {
        var grain = _cluster.GrainFactory.GetGrain<IPlayerGrain>(Guid.NewGuid());

        await grain.SetDisplayName("Alice");
        var profile = await grain.GetProfile();

        Assert.Equal("Alice", profile.DisplayName);
    }

    [Fact]
    public async Task RecordGameResult_Win_IncreasesRating()
    {
        var grain = _cluster.GrainFactory.GetGrain<IPlayerGrain>(Guid.NewGuid());

        await grain.RecordGameResult(won: true);
        var stats = await grain.GetStats();

        Assert.Equal(1, stats.GamesPlayed);
        Assert.Equal(1, stats.Wins);
        Assert.True(stats.Rating > 1000.0);
    }

    [Fact]
    public async Task ComplexIdentity_ParsesCorrectly()
    {
        var id = new TenantResourceId("tenant-1", "doc-42");
        var grain = _cluster.GrainFactory.GetGrain<IDocumentGrain>(id.ToString());

        await grain.UpdateContent("test content");
        var info = await grain.GetInfo();

        Assert.Equal("tenant-1", info.TenantId);
        Assert.Equal("doc-42", info.ResourceId);
    }
}
```
