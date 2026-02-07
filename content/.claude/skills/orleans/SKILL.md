# Orleans Development Skill

You are an expert in developing distributed applications with Microsoft Orleans. You have deep knowledge of the virtual actor model, grain development patterns, streaming, persistence, and cluster configuration. Always follow Orleans conventions and best practices.

## References

- [Orleans Documentation](https://learn.microsoft.com/en-us/dotnet/orleans/)
- [Orleans GitHub Repository](https://github.com/dotnet/orleans)
- [Local Samples Reference](./samples.md)

## Core Concepts

Orleans implements the **Virtual Actor Model**. Grains are the fundamental building blocks: virtual, distributed, asynchronous objects with stable identities. The runtime guarantees single-threaded execution per grain activation, eliminating the need for locks or synchronization within a grain.

Key properties of grains:
- Always exist virtually (no explicit create/destroy)
- Automatically activated on first request, deactivated when idle
- Single-threaded execution guarantee per activation
- Location-transparent addressing via `IGrainFactory`

## NuGet Packages

| Package | Purpose |
|---------|---------|
| `Microsoft.Orleans.Sdk` | Base SDK for all projects (includes Core, Analyzers, CodeGenerator) |
| `Microsoft.Orleans.Server` | Silo hosting (includes Runtime, Memory persistence) |
| `Microsoft.Orleans.Client` | Client-only projects |
| `Microsoft.Orleans.Streaming` | Stream providers |
| `Microsoft.Orleans.BroadcastChannel` | Broadcast channels |
| `Microsoft.Orleans.Persistence.AzureStorage` | Azure Blob/Table persistence |
| `Microsoft.Orleans.Persistence.Cosmos` | Azure Cosmos DB persistence |
| `Microsoft.Orleans.Persistence.AdoNet` | SQL database persistence |
| `Microsoft.Orleans.Persistence.Redis` | Redis persistence |
| `Microsoft.Orleans.Reminders` | Durable reminders |
| `Microsoft.Orleans.TestingHost` | Integration testing with TestCluster |

## Serialization

All types that cross grain boundaries must be serializable. Use the Orleans source-generated serializer:

```csharp
[GenerateSerializer]
public class MyData
{
    [Id(0)]
    public string Name { get; set; }

    [Id(1)]
    public int Value { get; set; }
}
```

Rules:
- Apply `[GenerateSerializer]` to all classes, structs, records, and enums passed between grains
- Assign `[Id(N)]` to every serialized field/property with unique sequential IDs
- Use `[Alias("stable-name")]` on types that may be renamed to maintain wire compatibility
- Each level in an inheritance hierarchy has its own ID space (child `[Id(0)]` does not conflict with parent `[Id(0)]`)
- Numeric types can be widened (int -> long) but signedness cannot change
- Use `[Immutable]` on types or members that will never change after construction to avoid defensive copies

## Grain Interfaces

Every grain interface must inherit from exactly one key marker interface:

| Interface | Key Type | Access Pattern |
|-----------|----------|----------------|
| `IGrainWithStringKey` | `string` | `GetGrain<T>(string key)` |
| `IGrainWithGuidKey` | `Guid` | `GetGrain<T>(Guid key)` |
| `IGrainWithIntegerKey` | `long` | `GetGrain<T>(long key)` |
| `IGrainWithGuidCompoundKey` | `Guid` + `string` | `GetGrain<T>(Guid key, string ext, null)` |
| `IGrainWithIntegerCompoundKey` | `long` + `string` | `GetGrain<T>(long key, string ext, null)` |

All grain methods must return `Task`, `Task<T>`, `ValueTask`, `ValueTask<T>`, or `IAsyncEnumerable<T>`.

```csharp
public interface IPlayerGrain : IGrainWithGuidKey
{
    Task<string> GetName();
    Task SetName(string name);
    Task JoinGame(IGameGrain game);
}
```

### Response Timeouts

Override the default 30-second timeout per method:

```csharp
public interface IProcessingGrain : IGrainWithStringKey
{
    [ResponseTimeout("00:02:00")]
    Task<Result> ProcessLargeDataset(Dataset data);

    [ResponseTimeout("00:00:05")]
    Task<HealthStatus> GetHealth();
}
```

## Grain Implementation

### Standard Grain (Inheriting from Grain)

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private string _name;
    private IGameGrain _currentGame;

    public override Task OnActivateAsync(CancellationToken cancellationToken)
    {
        // Called when grain is activated; initialize state here
        return base.OnActivateAsync(cancellationToken);
    }

    public override Task OnDeactivateAsync(DeactivationReason reason, CancellationToken cancellationToken)
    {
        // Best-effort cleanup; NOT guaranteed to be called (e.g., server crash)
        return base.OnDeactivateAsync(reason, cancellationToken);
    }

    public Task<string> GetName() => Task.FromResult(_name);

    public Task SetName(string name)
    {
        _name = name;
        return Task.CompletedTask;
    }

    public Task JoinGame(IGameGrain game)
    {
        _currentGame = game;
        return Task.CompletedTask;
    }
}
```

### POGO Grain (No Base Class)

Grains can be plain classes implementing `IGrainBase`:

```csharp
public class PlayerGrain : IPlayerGrain, IGrainBase
{
    public IGrainContext GrainContext { get; }

    public PlayerGrain(IGrainContext context)
    {
        GrainContext = context;
    }

    public Task OnActivateAsync(CancellationToken token) => Task.CompletedTask;
    public Task OnDeactivateAsync(DeactivationReason reason, CancellationToken token) => Task.CompletedTask;
}
```

### Accessing Grain Identity

```csharp
// Inside a grain:
Guid guidKey = this.GetPrimaryKey();
long longKey = this.GetPrimaryKeyLong();
string stringKey = this.GetPrimaryKeyString();
Guid compoundKey = this.GetPrimaryKey(out string keyExtension);
GrainId grainId = this.GetGrainId();
```

### Calling Other Grains

```csharp
// Inside a grain:
var otherGrain = GrainFactory.GetGrain<IOtherGrain>("some-key");
await otherGrain.DoSomething();

// Fan-out pattern:
var tasks = grainIds.Select(id => GrainFactory.GetGrain<IWorker>(id).Process(data));
await Task.WhenAll(tasks);
```

## Complex Grain Identity Pattern

When grains need to represent complex identity (multi-tenancy, categorized entities, composite keys), use a concatenated string grain ID with a `readonly record struct` that has a static `Parse` method.

Use `IGrainWithStringKey` and encode the composite identity as a delimited string.

```csharp
[GenerateSerializer]
public readonly record struct TenantEntityId(string TenantId, string EntityId)
{
    private const char Separator = '/';

    public override string ToString() => $"{TenantId}{Separator}{EntityId}";

    public static TenantEntityId Parse(string value)
    {
        var index = value.IndexOf(Separator);
        if (index < 0)
            throw new FormatException($"Invalid TenantEntityId format: '{value}'");

        return new TenantEntityId(
            value[..index],
            value[(index + 1)..]);
    }

    public static implicit operator string(TenantEntityId id) => id.ToString();
}
```

Usage:

```csharp
public interface IInventoryGrain : IGrainWithStringKey
{
    Task<int> GetQuantity();
    Task SetQuantity(int quantity);
}

public class InventoryGrain : Grain, IInventoryGrain
{
    private TenantEntityId _id;

    public override Task OnActivateAsync(CancellationToken cancellationToken)
    {
        _id = TenantEntityId.Parse(this.GetPrimaryKeyString());
        return base.OnActivateAsync(cancellationToken);
    }

    public Task<int> GetQuantity() { /* use _id.TenantId, _id.EntityId */ }
    public Task SetQuantity(int quantity) { /* ... */ }
}

// Getting a reference:
var id = new TenantEntityId("tenant-42", "item-abc");
var grain = grainFactory.GetGrain<IInventoryGrain>(id.ToString());
```

Guidelines for complex identity structs:
- Always use `readonly record struct` for value semantics and built-in equality
- Apply `[GenerateSerializer]` so the ID can be passed as a grain method argument
- Include a `const char Separator` (use `/` by convention)
- Override `ToString()` to produce the concatenated key
- Provide a static `Parse(string)` method that validates format and splits
- Provide `implicit operator string` for ergonomic use with `GetGrain<T>(string)`
- Parse the identity in `OnActivateAsync` and cache as a field
- Use descriptive segment names in the struct (e.g., `TenantId`, `CategoryId`, `EntityId`)
- For three-or-more segment keys, use the same pattern with additional segments:

```csharp
[GenerateSerializer]
public readonly record struct CategorizedEntityId(
    string TenantId, string Category, string EntityId)
{
    private const char Separator = '/';

    public override string ToString() =>
        $"{TenantId}{Separator}{Category}{Separator}{EntityId}";

    public static CategorizedEntityId Parse(string value)
    {
        var parts = value.Split(Separator, 3);
        if (parts.Length != 3)
            throw new FormatException($"Invalid CategorizedEntityId format: '{value}'");

        return new CategorizedEntityId(parts[0], parts[1], parts[2]);
    }

    public static implicit operator string(CategorizedEntityId id) => id.ToString();
}
```

## Grain Persistence

### Recommended: IPersistentState<T> via Constructor Injection

```csharp
[GenerateSerializer]
public class UserProfileState
{
    [Id(0)]
    public string DisplayName { get; set; }

    [Id(1)]
    public string Email { get; set; }

    [Id(2)]
    public DateTimeOffset CreatedAt { get; set; }
}

public class UserGrain : Grain, IUserGrain
{
    private readonly IPersistentState<UserProfileState> _profile;

    public UserGrain(
        [PersistentState("profile", "profileStore")]
        IPersistentState<UserProfileState> profile)
    {
        _profile = profile;
    }

    public Task<string> GetDisplayName() =>
        Task.FromResult(_profile.State.DisplayName);

    public async Task SetDisplayName(string name)
    {
        _profile.State.DisplayName = name;
        await _profile.WriteStateAsync();
    }
}
```

### Multiple Named State Objects

A grain can have multiple independent persisted state objects, potentially using different storage providers:

```csharp
public class UserGrain : Grain, IUserGrain
{
    private readonly IPersistentState<ProfileState> _profile;
    private readonly IPersistentState<PreferencesState> _preferences;

    public UserGrain(
        [PersistentState("profile", "profileStore")]
        IPersistentState<ProfileState> profile,
        [PersistentState("preferences", "preferencesStore")]
        IPersistentState<PreferencesState> preferences)
    {
        _profile = profile;
        _preferences = preferences;
    }
}
```

### IPersistentState<T> API

```csharp
public interface IPersistentState<TState>
{
    TState State { get; set; }       // Read/write the state object
    string Etag { get; }             // Optimistic concurrency tag
    bool RecordExists { get; }       // Whether state has been written before
    Task ClearStateAsync();          // Delete persisted state
    Task WriteStateAsync();          // Persist current state
    Task ReadStateAsync();           // Re-read state from storage
}
```

### Persistence Best Practices

- State is automatically read before `OnActivateAsync`. Never call `ReadStateAsync()` in activation unless you need to re-sync.
- The runtime never writes state automatically. You must call `WriteStateAsync()` explicitly.
- Call `WriteStateAsync()` at the end of grain methods and return its Task.
- Avoid unnecessary writes: check whether state actually changed before writing.
- A storage provider failure during initial read fails the entire grain activation.
- `InconsistentStateException` is thrown on ETag violations during writes; handle it for conflict resolution.
- Prefer `IPersistentState<T>` over the legacy `Grain<TState>` base class.

### Registering Storage Providers

```csharp
// Memory (development only):
siloBuilder.AddMemoryGrainStorage("profileStore");

// Azure Blob:
siloBuilder.AddAzureBlobGrainStorage("profileStore", options =>
{
    options.ConfigureBlobServiceClient(connectionString);
});

// Azure Table:
siloBuilder.AddAzureTableGrainStorage("profileStore", options =>
{
    options.ConfigureTableServiceClient(connectionString);
});

// Azure Cosmos DB:
siloBuilder.AddCosmosGrainStorage("profileStore", options =>
{
    options.ConfigureCosmosClient(connectionString);
});

// Redis:
siloBuilder.AddRedisGrainStorage("profileStore", options =>
{
    options.ConnectionString = connectionString;
});

// ADO.NET (SQL Server, PostgreSQL, MySQL):
siloBuilder.AddAdoNetGrainStorage("profileStore", options =>
{
    options.ConnectionString = connectionString;
    options.Invariant = "Microsoft.Data.SqlClient";
});
```

## Streams

Orleans Streams provide managed, reactive event processing with delivery guarantees, automatic backpressure, and lifecycle integration with grains.

### Stream Providers

| Provider | Delivery | NuGet Package |
|----------|----------|---------------|
| Memory Streams | Best-effort, at-most-once | Built-in (Orleans.Streaming) |
| Azure Queue | At-least-once | `Microsoft.Orleans.Streaming.AzureStorage` |
| Azure Event Hubs | At-least-once | `Microsoft.Orleans.Streaming.EventHubs` |
| NATS | Configurable | `Microsoft.Orleans.Streaming.Nats` |
| ADO.NET | At-least-once | `Microsoft.Orleans.Streaming.AdoNet` |

### Configuration

```csharp
// Memory streams (development):
siloBuilder
    .AddMemoryStreams("StreamProvider")
    .AddMemoryGrainStorage("PubSubStore");

// Azure Queue:
siloBuilder
    .AddAzureQueueStreams("StreamProvider", configurator =>
    {
        configurator.ConfigureAzureQueue(options =>
        {
            options.ConfigureQueueServiceClient(connectionString);
        });
    })
    .AddAzureTableGrainStorage("PubSubStore", options =>
    {
        options.ConfigureTableServiceClient(connectionString);
    });
```

A `PubSubStore` grain storage provider is required for stream subscription management.

### StreamId

```csharp
// Create a stream identity:
var streamId = StreamId.Create("MyNamespace", Guid.NewGuid());
var streamId = StreamId.Create("MyNamespace", "my-string-key");
var streamId = StreamId.Create("MyNamespace", 12345L);
```

### Producing Events

```csharp
public class ProducerGrain : Grain, IProducerGrain
{
    public async Task Produce(string message)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("Chat", this.GetPrimaryKeyString());
        var stream = streamProvider.GetStream<string>(streamId);

        await stream.OnNextAsync(message);
    }
}
```

### Consuming Events (Explicit Subscription)

```csharp
public class ConsumerGrain : Grain, IConsumerGrain
{
    private StreamSubscriptionHandle<string> _handle;

    public async Task Subscribe(string channelName)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("Chat", channelName);
        var stream = streamProvider.GetStream<string>(streamId);

        _handle = await stream.SubscribeAsync(
            async (message, token) =>
            {
                // Process the message
                await ProcessMessage(message);
            });
    }

    // IMPORTANT: Resume subscriptions after grain reactivation
    public override async Task OnActivateAsync(CancellationToken cancellationToken)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("Chat", this.GetPrimaryKeyString());
        var stream = streamProvider.GetStream<string>(streamId);

        var handles = await stream.GetAllSubscriptionHandles();
        foreach (var handle in handles)
        {
            await handle.ResumeAsync(async (message, token) =>
            {
                await ProcessMessage(message);
            });
        }

        await base.OnActivateAsync(cancellationToken);
    }
}
```

### Implicit Subscriptions

Implicit subscriptions automatically activate a grain when events arrive on a matching stream. The grain ID matches the stream key.

```csharp
[ImplicitStreamSubscription("Chat")]
public class ChatListenerGrain : Grain, IChatListenerGrain, IAsyncObserver<string>
{
    public override async Task OnActivateAsync(CancellationToken cancellationToken)
    {
        var streamProvider = this.GetStreamProvider("StreamProvider");
        var streamId = StreamId.Create("Chat", this.GetPrimaryKey());
        var stream = streamProvider.GetStream<string>(streamId);

        await stream.SubscribeAsync(this);
        await base.OnActivateAsync(cancellationToken);
    }

    public Task OnNextAsync(string item, StreamSequenceToken token = null)
    {
        // Process item
        return Task.CompletedTask;
    }

    public Task OnCompletedAsync() => Task.CompletedTask;
    public Task OnErrorAsync(Exception ex) => Task.CompletedTask;
}
```

Use `[RegexImplicitStreamSubscription("pattern")]` to match stream namespaces by regex.

### Stream Caveats

- **Do not use streams with `[StatelessWorker]` grains** -- this causes undefined behavior.
- Explicit subscriptions must be resumed in `OnActivateAsync` after grain reactivation.
- Azure Queue streams do NOT guarantee FIFO ordering.
- Always register a `PubSubStore` grain storage provider alongside the stream provider.

## Broadcast Channels

Broadcast channels provide one-way, one-to-many event distribution from a producer (typically non-grain code like a controller) to grain consumers. Unlike streams, broadcast channels are fire-and-forget by default and do not require a PubSubStore.

### Configuration

```csharp
siloBuilder.AddBroadcastChannel("MyChannel", options =>
{
    options.FireAndForgetDelivery = true; // default
});
```

### ChannelId

```csharp
var channelId = ChannelId.Create("MyNamespace", "my-key");
var channelId = ChannelId.Create("MyNamespace", Guid.NewGuid());
```

### Publishing (Producer Side)

```csharp
// From a controller, background service, or non-grain code:
app.MapPost("/events", async (IClusterClient client, MyEvent evt) =>
{
    var provider = client.ServiceProvider
        .GetRequiredKeyedService<IBroadcastChannelProvider>("MyChannel");
    var channelId = ChannelId.Create("Events", evt.Category);
    var writer = provider.GetChannelWriter<MyEvent>(channelId);

    await writer.Publish(evt);
    return Results.Ok();
});
```

### Consuming (Grain Side)

```csharp
[ImplicitChannelSubscription]
public class EventProcessorGrain : Grain, IEventProcessorGrain, IOnBroadcastChannelSubscribed
{
    public Task OnSubscribed(IBroadcastChannelSubscription subscription)
    {
        return subscription.Attach<MyEvent>(
            onPublished: async evt =>
            {
                await ProcessEvent(evt);
            },
            onError: async ex =>
            {
                // Handle errors
            });
    }
}
```

Subscription attributes:
- `[ImplicitChannelSubscription]` -- subscribe to all namespaces
- `[ImplicitChannelSubscription("Events")]` -- subscribe to specific namespace
- `[RegexImplicitChannelSubscription("Events.*")]` -- subscribe via regex

## Observers

Observers enable grains to send notifications to external clients or other grains via a callback pattern. They are inherently unreliable (best-effort delivery).

### Define the Observer Interface

```csharp
public interface IChatObserver : IGrainObserver
{
    Task ReceiveMessage(string user, string message);
}
```

All observer methods must return `Task`, `Task<T>`, `ValueTask`, or `ValueTask<T>`.

### Managing Observers in a Grain (ObserverManager)

```csharp
public class ChatRoomGrain : Grain, IChatRoomGrain
{
    private readonly ObserverManager<IChatObserver> _observers;

    public ChatRoomGrain(ILogger<ChatRoomGrain> logger)
    {
        _observers = new ObserverManager<IChatObserver>(
            TimeSpan.FromMinutes(5), logger);
    }

    public Task Subscribe(IChatObserver observer)
    {
        _observers.Subscribe(observer, observer);
        return Task.CompletedTask;
    }

    public Task Unsubscribe(IChatObserver observer)
    {
        _observers.Unsubscribe(observer);
        return Task.CompletedTask;
    }

    public Task SendMessage(string user, string message)
    {
        _observers.Notify(o => o.ReceiveMessage(user, message));
        return Task.CompletedTask;
    }
}
```

### Client-Side Observer

```csharp
public class ChatClient : IChatObserver
{
    public Task ReceiveMessage(string user, string message)
    {
        Console.WriteLine($"[{user}]: {message}");
        return Task.CompletedTask;
    }
}

// Register and subscribe:
var chatClient = new ChatClient();
var observerRef = grainFactory.CreateObjectReference<IChatObserver>(chatClient);
await chatRoomGrain.Subscribe(observerRef);

// IMPORTANT: Keep a strong reference to chatClient -- the object reference
// uses WeakReference internally and will be GC'd otherwise.
```

### Grain-to-Grain Observation

```csharp
// A grain subscribing to another grain's notifications (no CreateObjectReference needed):
await notifierGrain.Subscribe(this.AsReference<IChatObserver>());
```

### Observer Best Practices

- Observers are **unreliable** -- do not use for critical state changes. Use persistence or streams instead.
- `ObserverManager` automatically removes stale subscriptions after the configured expiration.
- Clients should resubscribe on a timer (e.g., every few minutes) to keep the subscription alive.
- Always maintain a strong reference to the client-side observer object to prevent garbage collection.
- Use `[OneWay]` on observer methods for fire-and-forget delivery when you do not need confirmation.

## Grain Call Filters (Interceptors)

Filters provide cross-cutting concerns (logging, auth, metrics) by intercepting grain method calls.

### Incoming Grain Call Filter (Silo-Wide)

```csharp
public class LoggingFilter : IIncomingGrainCallFilter
{
    private readonly ILogger<LoggingFilter> _logger;

    public LoggingFilter(ILogger<LoggingFilter> logger) => _logger = logger;

    public async Task Invoke(IIncomingGrainCallContext context)
    {
        var grainType = context.TargetContext.GrainInstance?.GetType().Name;
        var method = context.MethodName;

        _logger.LogInformation("Calling {Grain}.{Method}", grainType, method);

        try
        {
            await context.Invoke();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in {Grain}.{Method}", grainType, method);
            throw;
        }
    }
}

// Register:
siloBuilder.AddIncomingGrainCallFilter<LoggingFilter>();
```

### Outgoing Grain Call Filter

```csharp
public class ContextPropagationFilter : IOutgoingGrainCallFilter
{
    public async Task Invoke(IOutgoingGrainCallContext context)
    {
        // Propagate context to outgoing calls
        RequestContext.Set("correlation-id", Guid.NewGuid().ToString());
        await context.Invoke();
    }
}

// Register:
siloBuilder.AddOutgoingGrainCallFilter<ContextPropagationFilter>();
```

### Delegate-Based Filters

```csharp
siloBuilder.AddIncomingGrainCallFilter(async context =>
{
    if (string.Equals(context.InterfaceMethod?.Name, "SecureMethod"))
    {
        var token = RequestContext.Get("auth-token") as string;
        if (string.IsNullOrEmpty(token))
            throw new UnauthorizedAccessException("Missing auth token");
    }
    await context.Invoke();
});
```

### Per-Grain Filter

A grain can act as its own incoming filter by implementing `IIncomingGrainCallFilter`:

```csharp
public class AuditedGrain : Grain, IMyGrain, IIncomingGrainCallFilter
{
    public async Task Invoke(IIncomingGrainCallContext context)
    {
        // This filter only applies to calls targeting this grain
        await context.Invoke();
        // Post-call: log result, audit, etc.
    }

    // ... grain methods
}
```

### Filter Execution Order

1. Silo-wide incoming filters (in DI registration order)
2. Grain-level filter (if grain implements `IIncomingGrainCallFilter`)
3. Grain method execution

### IIncomingGrainCallContext Properties

| Property | Description |
|----------|-------------|
| `Grain` | The target grain instance |
| `SourceId` | The calling grain's GrainId (null if from client) |
| `TargetId` | The target grain's GrainId |
| `InterfaceMethod` | The interface MethodInfo being invoked |
| `ImplementationMethod` | The concrete MethodInfo on the grain class |
| `InterfaceName` | Name of the grain interface |
| `MethodName` | Name of the method |
| `Result` | Get/set the return value |
| `Invoke()` | Continue the filter chain |

### Filter Caveats

- You **must** call `await context.Invoke()` to continue execution. Omitting this skips the grain method entirely.
- Filters are invoked for ALL calls including system calls (streams, extensions). Check `ImplementationMethod` or `InterfaceName` to scope filter logic.
- Use `AddActivityPropagation()` for built-in `System.Diagnostics.Activity` propagation across grain calls.

## Stateless Worker Grains

Stateless workers provide automatic scale-out for stateless, parallelizable operations. Multiple activations of the same grain can exist simultaneously across silos.

```csharp
[StatelessWorker]
public class ValidationWorkerGrain : Grain, IValidationWorkerGrain
{
    public Task<ValidationResult> Validate(InputData data)
    {
        // Pure computation, no state
        return Task.FromResult(ValidateInternal(data));
    }
}
```

### Limiting Concurrent Activations

```csharp
[StatelessWorker(maxLocalWorkers: 4)]
public class RateLimitedWorkerGrain : Grain, IRateLimitedWorkerGrain
{
    // At most 4 activations per silo
}
```

If `maxLocalWorkers` is not specified, it defaults to the number of CPU cores.

### Key Properties

- **Local execution**: Requests prefer the calling silo, avoiding network hops
- **Auto-scaling**: The runtime creates more activations under load
- **No grain directory**: Stateless workers bypass the distributed grain directory
- **Non-addressable**: Two successive calls may go to different activations
- **Non-reentrant by default**: Add `[Reentrant]` explicitly if needed

### Stateless Worker Best Practices

- Use a single, well-known grain ID (e.g., `0` or `"default"`) for most cases
- Use multiple IDs only if you need logically separate worker pools
- Do not store meaningful state -- it can be lost at any time
- Do **not** use streams with stateless workers
- Add `[Reentrant]` if the worker performs async I/O and you want concurrent request processing

### Calling Stateless Workers

```csharp
var worker = GrainFactory.GetGrain<IValidationWorkerGrain>(0);
var result = await worker.Validate(inputData);
```

## Grain Services

Grain Services are silo-level singleton grains that start with the silo and run for its lifetime. They participate in the consistent hash ring and can be used for background processing, monitoring, or providing silo-scoped services to grains.

### Define the Interface

```csharp
public interface IDataSyncService : IGrainService
{
    Task RequestSync(string entityId);
}
```

### Implement the Service

```csharp
[Reentrant]
public class DataSyncService : GrainService, IDataSyncService
{
    private readonly IGrainFactory _grainFactory;

    public DataSyncService(
        IServiceProvider services,
        GrainId id,
        Silo silo,
        ILoggerFactory loggerFactory,
        IGrainFactory grainFactory)
        : base(id, silo, loggerFactory)
    {
        _grainFactory = grainFactory;
    }

    public override Task Init(IServiceProvider serviceProvider)
    {
        return base.Init(serviceProvider);
    }

    public override async Task Start()
    {
        await base.Start();
        // Start background work
    }

    public override async Task Stop()
    {
        // Clean up
        await base.Stop();
    }

    public Task RequestSync(string entityId)
    {
        // Perform sync logic
        return Task.CompletedTask;
    }
}
```

### Create the Client Proxy

```csharp
public interface IDataSyncServiceClient : IGrainServiceClient<IDataSyncService>, IDataSyncService
{
}

public class DataSyncServiceClient : GrainServiceClient<IDataSyncService>, IDataSyncServiceClient
{
    public DataSyncServiceClient(IServiceProvider serviceProvider)
        : base(serviceProvider)
    {
    }

    // Route to the GrainService instance responsible for the calling grain
    private IDataSyncService GrainService =>
        GetGrainService(CurrentGrainReference.GrainId);

    public Task RequestSync(string entityId) =>
        GrainService.RequestSync(entityId);
}
```

### Register and Use

```csharp
// Registration:
siloBuilder.AddGrainService<DataSyncService>();
siloBuilder.ConfigureServices(services =>
{
    services.AddSingleton<IDataSyncServiceClient, DataSyncServiceClient>();
});

// Use from a grain via constructor injection:
public class MyGrain : Grain, IMyGrain
{
    private readonly IDataSyncServiceClient _syncService;

    public MyGrain(IDataSyncServiceClient syncService)
    {
        _syncService = syncService;
    }

    public async Task UpdateData(string entityId)
    {
        await _syncService.RequestSync(entityId);
    }
}
```

### GrainService Routing

The `GrainServiceClient<T>` provides routing methods:
- `GetGrainService(GrainId)` -- route to the service instance owning a specific grain
- `GetGrainService(uint)` -- route by numeric hash
- `GetGrainService(SiloAddress)` -- target a specific silo

## Concurrency and Reentrancy

Grains are non-reentrant by default: only one request executes at a time, and new requests queue until the current one completes. This prevents deadlocks and state corruption but can cause issues with grain-to-grain call chains.

### Reentrancy Attributes

| Attribute | Scope | Effect |
|-----------|-------|--------|
| `[Reentrant]` | Class | All methods on the grain may interleave |
| `[AlwaysInterleave]` | Method (interface) | This method always interleaves, even with non-reentrant grains |
| `[ReadOnly]` | Method (interface) | Method does not modify state; can run concurrently with other read-only methods |
| `[MayInterleave("Predicate")]` | Class | Conditional reentrancy via a static bool predicate |
| `[OneWay]` | Method (interface) | Fire-and-forget; caller does not await a response |

### Deadlock Prevention

Circular grain calls (A calls B, B calls A) will deadlock with non-reentrant grains. Solutions:
- Use `[Reentrant]` on grains involved in circular call chains
- Mark specific methods with `[AlwaysInterleave]` or `[ReadOnly]`
- Redesign to avoid circular dependencies

## Timers and Reminders

### Timers (Non-Durable)

Timers exist only while the grain is activated and are lost on deactivation.

```csharp
public class PollingGrain : Grain, IPollingGrain
{
    private IGrainTimer _timer;

    public override Task OnActivateAsync(CancellationToken cancellationToken)
    {
        _timer = this.RegisterGrainTimer(
            callback: static async (state, ct) =>
            {
                await state.PollExternalService();
            },
            state: this,
            options: new GrainTimerCreationOptions
            {
                DueTime = TimeSpan.Zero,
                Period = TimeSpan.FromSeconds(30),
                Interleave = false,
                KeepAlive = true
            });

        return base.OnActivateAsync(cancellationToken);
    }
}
```

- `Interleave = true` allows the timer callback to run concurrently with grain method calls
- `KeepAlive = true` prevents the grain from being deactivated while the timer is active

### Reminders (Durable)

Reminders persist across grain activations and silo restarts. The grain must implement `IRemindable`.

```csharp
public class BillingGrain : Grain, IBillingGrain, IRemindable
{
    public async Task SetupMonthlyBilling()
    {
        await this.RegisterOrUpdateReminder(
            "monthly-billing",
            dueTime: TimeSpan.FromHours(1),
            period: TimeSpan.FromDays(30));
    }

    public Task ReceiveReminder(string reminderName, TickStatus status)
    {
        if (reminderName == "monthly-billing")
        {
            // Process billing
        }
        return Task.CompletedTask;
    }
}
```

Reminders require a reminder storage provider (e.g., `UseInMemoryReminderService()` for development, or a persistent provider for production).

## Silo Configuration

### Minimal Development Setup

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.UseOrleans(siloBuilder =>
{
    siloBuilder.UseLocalhostClustering();
    siloBuilder.AddMemoryGrainStorage("Default");
});
var app = builder.Build();
```

### Production Setup

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.UseOrleans(siloBuilder =>
{
    siloBuilder
        .Configure<ClusterOptions>(options =>
        {
            options.ClusterId = "prod-cluster";
            options.ServiceId = "MyService";  // Must remain stable across deployments
        })
        .Configure<EndpointOptions>(options =>
        {
            options.SiloPort = 11_111;
            options.GatewayPort = 30_000;
            options.AdvertisedIPAddress = IPAddress.Parse("10.0.0.1");
        })
        .UseAzureStorageClustering(options =>
        {
            options.ConfigureTableServiceClient(connectionString);
        })
        .AddAzureBlobGrainStorage("Default", options =>
        {
            options.ConfigureBlobServiceClient(connectionString);
        })
        .AddMemoryStreams("StreamProvider")
        .AddIncomingGrainCallFilter<LoggingFilter>()
        .AddActivityPropagation();
});
```

### Client Configuration (Separate Process)

```csharp
var builder = Host.CreateApplicationBuilder(args);
builder.UseOrleansClient(clientBuilder =>
{
    clientBuilder
        .Configure<ClusterOptions>(options =>
        {
            options.ClusterId = "prod-cluster";
            options.ServiceId = "MyService";
        })
        .UseAzureStorageClustering(options =>
        {
            options.ConfigureTableServiceClient(connectionString);
        });
});
```

**Important**: Do NOT use both `UseOrleans` and `UseOrleansClient` in the same process. `UseOrleans` automatically includes a co-hosted client accessible via `IClusterClient`.

### .NET Aspire Integration

```csharp
// AppHost project:
var redis = builder.AddRedis("redis");
var orleans = builder.AddOrleans("cluster")
    .WithClustering(redis)
    .WithGrainStorage("Default", redis)
    .WithReminders(redis);

builder.AddProject<Projects.Silo>("silo")
    .WithReference(orleans)
    .WithReference(redis)
    .WithReplicas(3);

builder.AddProject<Projects.Api>("api")
    .WithReference(orleans.AsClient())
    .WithReference(redis);
```

## Testing

Use `Microsoft.Orleans.TestingHost` for integration tests:

```csharp
public class GrainTests
{
    [Fact]
    public async Task TestPlayerGrain()
    {
        var builder = new TestClusterBuilder();
        builder.AddSiloBuilderConfigurator<TestSiloConfig>();
        var cluster = builder.Build();
        await cluster.DeployAsync();

        try
        {
            var grain = cluster.GrainFactory.GetGrain<IPlayerGrain>(Guid.NewGuid());
            await grain.SetName("Alice");
            var name = await grain.GetName();
            Assert.Equal("Alice", name);
        }
        finally
        {
            await cluster.StopAllSilosAsync();
        }
    }
}

public class TestSiloConfig : ISiloConfigurator
{
    public void Configure(ISiloBuilder siloBuilder)
    {
        siloBuilder.AddMemoryGrainStorage("Default");
    }
}
```

## Placement Strategies

Control where grain activations are created:

| Attribute | Strategy |
|-----------|----------|
| `[RandomPlacement]` | Random silo (default) |
| `[PreferLocalPlacement]` | Prefer the calling silo |
| `[HashBasedPlacement]` | Deterministic hash-based silo selection |
| `[ActivationCountBasedPlacement]` | Balance by activation count |
| `[ResourceOptimizedPlacement]` | Balance by CPU/memory usage |
| `[StatelessWorker]` | Local, no-directory stateless activation |

```csharp
[PreferLocalPlacement]
public class LocalCacheGrain : Grain, ILocalCacheGrain
{
    // Activated on the calling silo when possible
}
```

## General Best Practices

1. **Grain design**: Treat grains as encapsulated distributed objects. Avoid chatty inter-grain calls. Prefer coarse-grained operations.
2. **Async**: Never block threads. Use `await` everywhere. Use `Task.WhenAll` for fan-out. Return `Task.CompletedTask` for synchronous paths.
3. **State**: Use `IPersistentState<T>` (not `Grain<T>`). Write state explicitly. Minimize write frequency.
4. **Deactivation**: Never rely on `OnDeactivateAsync` for critical operations -- it is not guaranteed to be called.
5. **Serialization**: All grain method arguments and return types must have `[GenerateSerializer]`. Use `[Id(N)]` on all members.
6. **Identity**: Use the complex grain identity pattern (readonly record struct) for multi-segment keys.
7. **Concurrency**: Understand reentrancy implications. Use `[ReadOnly]` for query methods. Avoid circular grain call chains.
8. **Testing**: Use `TestCluster` from `Microsoft.Orleans.TestingHost` for integration tests.
9. **Configuration**: `ServiceId` must be stable across deployments. `ClusterId` can change.
10. **Observers**: Treat as unreliable. Resubscribe periodically. For reliable notifications, use streams instead.
