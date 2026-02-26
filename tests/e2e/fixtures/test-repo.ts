/**
 * Test Java Repository Fixture
 *
 * Creates a temporary Java repository with test code for E2E testing.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

export class TestJavaRepository {
  private tempDir: string | null = null;
  public repoName: string;
  public dbPath: string;

  constructor(repoName = 'test-repo') {
    this.repoName = repoName;
    this.dbPath = path.join(os.tmpdir(), `java-kg-test-${Date.now()}`);
  }

  async create(): Promise<void> {
    // Create temporary directory
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-test-'));

    // Create directory structure
    const srcDir = path.join(this.tempDir, 'src/main/java/com/example');
    await fs.mkdir(srcDir, { recursive: true });

    // Create test Java files
    await this.createTestJavaFiles(srcDir);

    // Index the repository using CLI
    this.indexRepository();
  }

  private async createTestJavaFiles(srcDir: string): Promise<void> {
    // UserService.java
    const userService = `
package com.example;

import java.util.List;
import java.util.Optional;

/**
 * Service for managing users.
 */
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
}
`;

    // UserRepository.java
    const userRepository = `
package com.example;

import java.util.List;
import java.util.Optional;

public interface UserRepository {
    User save(User user);
    Optional<User> findById(Long id);
    List<User> findAll();
    void delete(Long id);
}
`;

    // EmailService.java
    const emailService = `
package com.example;

public class EmailService {
    public void sendWelcomeEmail(String email) {
        // Email sending logic
    }

    public void sendPasswordResetEmail(String email) {
        // Password reset logic
    }
}
`;

    // User.java
    const user = `
package com.example;

public class User {
    private Long id;
    private String name;
    private String email;

    public User(String name, String email) {
        this.name = name;
        this.email = email;
    }

    // Getters and setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
`;

    // Product.java
    const product = `
package com.example;

public class Product {
    private Long id;
    private String name;
    private double price;

    public Product(String name, double price) {
        this.name = name;
        this.price = price;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setPrice(double price) { this.price = price; }
}
`;

    // ProductService.java
    const productService = `
package com.example;

import java.util.List;

public class ProductService {
    private ProductRepository productRepository;

    public ProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public Product createProduct(String name, double price) {
        Product product = new Product(name, price);
        return productRepository.save(product);
    }

    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }
}
`;

    // ProductRepository.java
    const productRepository = `
package com.example;

import java.util.List;

public interface ProductRepository {
    Product save(Product product);
    List<Product> findAll();
}
`;

    // Controller.java
    const controller = `
package com.example;

public class Controller {
    private UserService userService;
    private ProductService productService;

    public Controller(UserService userService, ProductService productService) {
        this.userService = userService;
        this.productService = productService;
    }

    public void handleUserRequest(Long userId) {
        userService.findUserById(userId).ifPresent(user -> {
            // Process user
        });
    }

    public void handleProductRequest(Long productId) {
        // Handle product
    }
}
`;

    // Write files
    await fs.writeFile(path.join(srcDir, 'UserService.java'), userService);
    await fs.writeFile(path.join(srcDir, 'UserRepository.java'), userRepository);
    await fs.writeFile(path.join(srcDir, 'EmailService.java'), emailService);
    await fs.writeFile(path.join(srcDir, 'User.java'), user);
    await fs.writeFile(path.join(srcDir, 'Product.java'), product);
    await fs.writeFile(path.join(srcDir, 'ProductService.java'), productService);
    await fs.writeFile(path.join(srcDir, 'ProductRepository.java'), productRepository);
    await fs.writeFile(path.join(srcDir, 'Controller.java'), controller);
  }

  private indexRepository(): void {
    try {
      // Initialize the repository
      execSync(`node packages/cli/dist/index.js init "${this.tempDir}" --db-path "${this.dbPath}"`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      // Index the code
      execSync(`node packages/cli/dist/index.js index --db-path "${this.dbPath}"`, {
        cwd: this.tempDir,
        stdio: 'pipe',
      });
    } catch (error) {
      // CLI might not be built yet, skip indexing for development
      console.log('Note: CLI indexing skipped (build required)');
    }
  }

  async cleanup(): Promise<void> {
    if (this.tempDir) {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }

    // Cleanup database
    try {
      await fs.rm(this.dbPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  getPath(): string {
    return this.tempDir!;
  }
}
