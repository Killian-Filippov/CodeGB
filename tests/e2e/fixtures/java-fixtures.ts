/**
 * Java Code Fixtures
 *
 * Provides pre-built Java code snippets for E2E testing.
 * Each fixture represents a common Java pattern or structure.
 */

export const JAVA_FIXTURES = {
  // Basic class with methods
  simpleClass: `
package com.example;

public class SimpleClass {
    private String name;

    public SimpleClass(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
`,

  // Service with dependencies
  serviceClass: `
package com.example.service;

import java.util.List;
import java.util.Optional;

public class UserService {
    private UserRepository userRepository;
    private EmailService emailService;

    public UserService(UserRepository userRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }

    public User createUser(String name, String email) {
        User user = new User(name, email);
        User saved = userRepository.save(user);
        emailService.sendWelcomeEmail(email);
        return saved;
    }

    public Optional<User> findUserById(Long id) {
        return userRepository.findById(id);
    }

    public List<User> getAllUsers() {
        return userRepository.findAll();
    }

    public void deleteUser(Long id) {
        userRepository.delete(id);
    }

    public void updateUser(Long id, String newName) {
        userRepository.findById(id).ifPresent(user -> {
            user.setName(newName);
            userRepository.save(user);
        });
    }
}
`,

  // Interface definition
  interfaceDefinition: `
package com.example.repository;

import java.util.List;
import java.util.Optional;

public interface UserRepository {
    User save(User user);
    Optional<User> findById(Long id);
    List<User> findAll();
    void delete(Long id);
    User update(User user);
}
`,

  // Interface implementation
  interfaceImpl: `
package com.example.repository.impl;

import java.util.*;
import com.example.repository.UserRepository;

public class UserRepositoryImpl implements UserRepository {
    private Map<Long, User> storage = new HashMap<>();

    @Override
    public User save(User user) {
        if (user.getId() == null) {
            user.setId(System.currentTimeMillis());
        }
        storage.put(user.getId(), user);
        return user;
    }

    @Override
    public Optional<User> findById(Long id) {
        return Optional.ofNullable(storage.get(id));
    }

    @Override
    public List<User> findAll() {
        return new ArrayList<>(storage.values());
    }

    @Override
    public void delete(Long id) {
        storage.remove(id);
    }

    @Override
    public User update(User user) {
        if (storage.containsKey(user.getId())) {
            storage.put(user.getId(), user);
            return user;
        }
        throw new IllegalArgumentException("User not found");
    }
}
`,

  // Inheritance hierarchy
  inheritance: `
package com.example;

public abstract class BaseEntity {
    private Long id;
    private Date createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Date getCreatedAt() {
        return createdAt;
    }
}

public class User extends BaseEntity {
    private String name;
    private String email;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }
}

public class Product extends BaseEntity {
    private String productName;
    private double price;

    public String getProductName() {
        return productName;
    }

    public void setPrice(double price) {
        this.price = price;
    }
}
`,

  // Enum
  enumDefinition: `
package com.example;

public enum OrderStatus {
    PENDING("Order is pending"),
    PROCESSING("Order is being processed"),
    SHIPPED("Order has been shipped"),
    DELIVERED("Order has been delivered"),
    CANCELLED("Order has been cancelled");

    private final String description;

    OrderStatus(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
`,

  // Controller with multiple methods
  controller: `
package com.example.controller;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findUserById(id).orElse(null);
    }

    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.createUser(user.getName(), user.getEmail());
    }

    @GetMapping
    public List<User> getAllUsers() {
        return userService.getAllUsers();
    }

    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable Long id) {
        userService.deleteUser(id);
    }
}
`,

  // Complex method with logic
  complexMethod: `
package com.example;

import java.util.*;
import java.util.stream.Collectors;

public class DataProcessor {
    private DataSource dataSource;
    private Cache cache;

    public List<Result> processData(String query) {
        // Check cache first
        List<Result> cached = cache.get(query);
        if (cached != null) {
            return cached;
        }

        // Fetch from data source
        List<RawData> rawData = dataSource.fetch(query);

        // Process data
        List<Result> results = rawData.stream()
            .filter(this::isValid)
            .map(this::transform)
            .filter(Objects::nonNull)
            .collect(Collectors.toList());

        // Cache results
        cache.put(query, results);

        return results;
    }

    private boolean isValid(RawData data) {
        return data != null && data.getValue() > 0;
    }

    private Result transform(RawData data) {
        Result result = new Result();
        result.setId(data.getId());
        result.setValue(data.getValue() * 2);
        return result;
    }
}
`,

  // Annotation usage
  annotatedClass: `
package com.example;

import javax.persistence.*;
import javax.validation.constraints.*;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    @NotBlank
    @Size(min = 2, max = 100)
    private String name;

    @Column(nullable = false, unique = true)
    @Email
    private String email;

    @Column
    @Past
    private Date birthDate;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }

    public Date getBirthDate() {
        return birthDate;
    }
}
`,

  // Builder pattern
  builderPattern: `
package com.example;

public class Configuration {
    private String host;
    private int port;
    private boolean useSSL;
    private int timeout;

    private Configuration(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.useSSL = builder.useSSL;
        this.timeout = builder.timeout;
    }

    public static class Builder {
        private String host = "localhost";
        private int port = 8080;
        private boolean useSSL = false;
        private int timeout = 30000;

        public Builder host(String host) {
            this.host = host;
            return this;
        }

        public Builder port(int port) {
            this.port = port;
            return this;
        }

        public Builder useSSL(boolean useSSL) {
            this.useSSL = useSSL;
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        public Configuration build() {
            return new Configuration(this);
        }
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public boolean isUseSSL() {
        return useSSL;
    }

    public int getTimeout() {
        return timeout;
    }
}
`,

  // Singleton pattern
  singleton: `
package com.example;

public class DatabaseConnection {
    private static DatabaseConnection instance;
    private String connectionString;

    private DatabaseConnection() {
        this.connectionString = "default";
    }

    public static synchronized DatabaseConnection getInstance() {
        if (instance == null) {
            instance = new DatabaseConnection();
        }
        return instance;
    }

    public void connect() {
        System.out.println("Connecting to " + connectionString);
    }

    public void disconnect() {
        System.out.println("Disconnecting");
    }
}
`,

  // Factory pattern
  factoryPattern: `
package com.example;

public interface PaymentProcessor {
    void processPayment(double amount);
}

public class CreditCardProcessor implements PaymentProcessor {
    @Override
    public void processPayment(double amount) {
        System.out.println("Processing credit card payment: $" + amount);
    }
}

public class PayPalProcessor implements PaymentProcessor {
    @Override
    public void processPayment(double amount) {
        System.out.println("Processing PayPal payment: $" + amount);
    }
}

public class PaymentProcessorFactory {
    public static PaymentProcessor createProcessor(String type) {
        switch (type.toLowerCase()) {
            case "creditcard":
                return new CreditCardProcessor();
            case "paypal":
                return new PayPalProcessor();
            default:
                throw new IllegalArgumentException("Unsupported payment type: " + type);
        }
    }
}
`,

  // Lambda and Stream API
  lambdas: `
package com.example;

import java.util.*;
import java.util.function.*;
import java.util.stream.Collectors;

public class StreamOperations {
    private List<String> data;

    public StreamOperations(List<String> data) {
        this.data = data;
    }

    public List<String> filterByPrefix(String prefix) {
        return data.stream()
            .filter(s -> s.startsWith(prefix))
            .collect(Collectors.toList());
    }

    public String concatenate(String delimiter) {
        return data.stream()
            .collect(Collectors.joining(delimiter));
    }

    public Map<Boolean, List<String>> partitionByLength(int threshold) {
        return data.stream()
            .collect(Collectors.partitioningBy(s -> s.length() > threshold));
    }

    public Optional<String> findFirstStartingWith(String prefix) {
        return data.stream()
            .filter(s -> s.startsWith(prefix))
            .findFirst();
    }

    public int calculateTotalLength() {
        return data.stream()
            .mapToInt(String::length)
            .sum();
    }
}
`,

  // Exception handling
  exceptionHandling: `
package com.example;

public class Validator {
    public void validateUser(User user) {
        if (user == null) {
            throw new IllegalArgumentException("User cannot be null");
        }

        if (user.getName() == null || user.getName().isEmpty()) {
            throw new ValidationException("User name is required");
        }

        if (user.getEmail() == null || !user.getEmail().contains("@")) {
            throw new ValidationException("Invalid email address");
        }
    }

    public void processUser(User user) {
        try {
            validateUser(user);
            saveUser(user);
        } catch (ValidationException e) {
            logError(e);
            throw new ProcessingException("Failed to process user", e);
        } catch (Exception e) {
            logError(e);
            throw new ProcessingException("Unexpected error", e);
        } finally {
            cleanup();
        }
    }

    private void saveUser(User user) {
        // Save logic
    }

    private void logError(Exception e) {
        System.err.println("Error: " + e.getMessage());
    }

    private void cleanup() {
        // Cleanup logic
    }
}

class ValidationException extends RuntimeException {
    public ValidationException(String message) {
        super(message);
    }
}

class ProcessingException extends RuntimeException {
    public ProcessingException(String message, Throwable cause) {
        super(message, cause);
    }
}
`,

  // Generic class
  generics: `
package com.example;

import java.util.*;

public class Repository<T> {
    private Map<Long, T> storage = new HashMap<>();
    private Long idSequence = 0L;

    public T save(T entity) {
        idSequence++;
        storage.put(idSequence, entity);
        return entity;
    }

    public Optional<T> findById(Long id) {
        return Optional.ofNullable(storage.get(id));
    }

    public List<T> findAll() {
        return new ArrayList<>(storage.values());
    }

    public void delete(Long id) {
        storage.remove(id);
    }

    public List<T> filter(Predicate<T> predicate) {
        return storage.values().stream()
            .filter(predicate)
            .collect(Collectors.toList());
    }
}

class UserService {
    private Repository<User> userRepository;

    public UserService(Repository<User> userRepository) {
        this.userRepository = userRepository;
    }

    public List<User> findActiveUsers() {
        return userRepository.filter(user -> user.isActive());
    }
}
`,

  // Multi-threading
  multiThreading: `
package com.example;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class TaskExecutor {
    private ExecutorService executor;
    private AtomicInteger counter = new AtomicInteger(0);

    public TaskExecutor(int threadPoolSize) {
        this.executor = Executors.newFixedThreadPool(threadPoolSize);
    }

    public Future<Result> submitTask(Task task) {
        return executor.submit(() -> {
            counter.incrementAndGet();
            try {
                return task.execute();
            } finally {
                counter.decrementAndGet();
            }
        });
    }

    public CompletableFuture<Result> submitAsyncTask(Task task) {
        return CompletableFuture.supplyAsync(() -> task.execute(), executor);
    }

    public List<Future<Result>> submitAllTasks(List<Task> tasks) {
        return tasks.stream()
            .map(this::submitTask)
            .collect(Collectors.toList());
    }

    public void shutdown() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    public int getActiveTaskCount() {
        return counter.get();
    }
}
`,

  // Complete Spring Boot application structure
  springBoot: `
package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestTemplate;

@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
`,

  // JPA Entity with relationships
  jpaEntity: `
package com.example.entity;

import javax.persistence.*;
import java.util.*;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Date orderDate;

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @ManyToOne
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL)
    private List<OrderItem> items = new ArrayList<>();

    @Column
    private Double totalAmount;

    public Long getId() {
        return id;
    }

    public Date getOrderDate() {
        return orderDate;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public User getUser() {
        return user;
    }

    public List<OrderItem> getItems() {
        return items;
    }

    public Double getTotalAmount() {
        return totalAmount;
    }
}

@Entity
@Table(name = "order_items")
public class OrderItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @ManyToOne
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(nullable = false)
    private Integer quantity;

    @Column(nullable = false)
    private Double unitPrice;

    public Long getId() {
        return id;
    }

    public Order getOrder() {
        return order;
    }

    public Product getProduct() {
        return product;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public Double getUnitPrice() {
        return unitPrice;
    }

    public Double getTotalPrice() {
        return quantity * unitPrice;
    }
}
`,

  // REST Controller with all HTTP methods
  restController: `
package com.example.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping
    public ResponseEntity<List<Product>> getAllProducts(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(productService.findAll(page, size));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(@PathVariable Long id) {
        return productService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Product> createProduct(@RequestBody Product product) {
        Product saved = productService.save(product);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Product> updateProduct(
        @PathVariable Long id,
        @RequestBody Product product) {
        return productService.update(id, product)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Product> patchProduct(
        @PathVariable Long id,
        @RequestBody Map<String, Object> updates) {
        return productService.partialUpdate(id, updates)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        if (productService.delete(id)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }

    @GetMapping("/search")
    public ResponseEntity<List<Product>> searchProducts(
        @RequestParam String keyword) {
        return ResponseEntity.ok(productService.search(keyword));
    }

    @GetMapping("/category/{categoryId}")
    public ResponseEntity<List<Product>> getProductsByCategory(
        @PathVariable Long categoryId) {
        return ResponseEntity.ok(productService.findByCategory(categoryId));
    }
}
`,

  // Service layer with business logic
  serviceLayer: `
package com.example.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
@Transactional
public class OrderService {
    private OrderRepository orderRepository;
    private ProductService productService;
    private InventoryService inventoryService;
    private NotificationService notificationService;

    public OrderService(
        OrderRepository orderRepository,
        ProductService productService,
        InventoryService inventoryService,
        NotificationService notificationService) {
        this.orderRepository = orderRepository;
        this.productService = productService;
        this.inventoryService = inventoryService;
        this.notificationService = notificationService;
    }

    public Order createOrder(CreateOrderRequest request) {
        // Validate request
        if (request.getItems() == null || request.getItems().isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one item");
        }

        // Create order
        Order order = new Order();
        order.setOrderDate(new Date());
        order.setStatus(OrderStatus.PENDING);

        // Add items
        List<OrderItem> items = new ArrayList<>();
        double totalAmount = 0.0;

        for (OrderItemRequest itemRequest : request.getItems()) {
            Product product = productService.findById(itemRequest.getProductId())
                .orElseThrow(() -> new IllegalArgumentException("Product not found"));

            // Check inventory
            if (!inventoryService.checkAvailability(
                product.getId(),
                itemRequest.getQuantity())) {
                throw new IllegalStateException("Product not available");
            }

            OrderItem item = new OrderItem();
            item.setOrder(order);
            item.setProduct(product);
            item.setQuantity(itemRequest.getQuantity());
            item.setUnitPrice(product.getPrice());

            items.add(item);
            totalAmount += item.getTotalPrice();
        }

        order.setItems(items);
        order.setTotalAmount(totalAmount);

        // Save order
        Order savedOrder = orderRepository.save(order);

        // Reserve inventory
        for (OrderItem item : items) {
            inventoryService.reserve(
                item.getProduct().getId(),
                item.getQuantity());
        }

        // Send notification
        notificationService.sendOrderConfirmation(savedOrder);

        return savedOrder;
    }

    public Order getOrder(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("Order not found"));
    }

    public List<Order> getUserOrders(Long userId) {
        return orderRepository.findByUserId(userId);
    }

    @Transactional
    public Order cancelOrder(Long orderId) {
        Order order = getOrder(orderId);

        if (order.getStatus() != OrderStatus.PENDING) {
            throw new IllegalStateException("Order cannot be cancelled");
        }

        // Release inventory
        for (OrderItem item : order.getItems()) {
            inventoryService.release(
                item.getProduct().getId(),
                item.getQuantity());
        }

        order.setStatus(OrderStatus.CANCELLED);
        return orderRepository.save(order);
    }
}
`,

  // Repository layer with JPA
  repositoryLayer: `
package com.example.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    List<Order> findByUserId(Long userId);

    List<Order> findByStatus(OrderStatus status);

    List<Order> findByOrderDateBetween(Date startDate, Date endDate);

    @Query("SELECT o FROM Order o WHERE o.user.id = :userId AND o.status = :status")
    List<Order> findByUserAndStatus(@Param("userId") Long userId,
                                    @Param("status") OrderStatus status);

    @Query("SELECT COUNT(o) FROM Order o WHERE o.user.id = :userId")
    Long countByUserId(@Param("userId") Long userId);

    @Query("SELECT SUM(o.totalAmount) FROM Order o WHERE o.user.id = :userId")
    Double getTotalSpentByUserId(@Param("userId") Long userId);

    List<Order> findTop10ByOrderByOrderDateDesc();
}
`,
};

/**
 * Get fixture by name
 */
export function getFixture(name: keyof typeof JAVA_FIXTURES): string {
  return JAVA_FIXTURES[name];
}

/**
 * Get multiple fixtures
 */
export function getFixtures(names: (keyof typeof JAVA_FIXTURES)[]): string {
  return names.map(name => JAVA_FIXTURES[name]).join('\n\n');
}

/**
 * Fixture categories for organized testing
 */
export const FIXTURE_CATEGORIES = {
  basics: ['simpleClass', 'enumDefinition'],
  patterns: ['builderPattern', 'singleton', 'factoryPattern'],
  services: ['serviceClass', 'exceptionHandling', 'complexMethod'],
  controllers: ['controller', 'restController'],
  data: ['repositoryLayer', 'jpaEntity', 'interfaceDefinition', 'interfaceImpl'],
  advanced: ['generics', 'lambdas', 'multiThreading'],
  frameworks: ['springBoot', 'serviceLayer'],
} as const;
